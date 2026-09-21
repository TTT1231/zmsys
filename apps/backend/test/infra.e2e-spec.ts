/**
 * 基础设施并发专项 e2e：真实 MySQL 测试库（*_test），验证契约关键路径——
 * UTC 时区闭环、取号唯一与回滚还原、幂等“恰一次提交业务效果”、真实死锁识别与重试。
 * 双通道：主体走 app→Prisma 生产链路；死锁干扰用原生 mariadb 连接直连制造。
 */
import "./db-guard";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import mariadb from "mariadb";
import { AppModule } from "../src/app.module";
import { IdempotencyModule } from "../src/idempotency/idempotency.module";
import { SequenceModule } from "../src/sequence/sequence.module";
import { configureApp } from "../src/main";
import { PrismaService } from "../src/prisma/prisma.service";
import { TransactionRunner } from "../src/prisma/transaction.runner";
import { BusinessSequenceService } from "../src/sequence/business-sequence.service";
import { IdempotencyService } from "../src/idempotency/idempotency.service";
import { TestIdempotencyController } from "./test-idempotency.controller";
import { TEST_DATABASE } from "./db-guard";

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** 硬超时：死锁等干扰用例在 CI 偶发阻塞时快速失败而非永久挂起 */
const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    return await Promise.race([
        promise,
        sleep(ms).then(() => {
            throw new Error(`用例超时（${ms}ms）：${label}`);
        }),
    ]);
};

describe("基础设施并发专项 (e2e)", () => {
    let app: NestFastifyApplication;
    let prisma: PrismaService;
    let runner: TransactionRunner;
    let sequence: BusinessSequenceService;
    let idempotency: IdempotencyService;

    beforeAll(async () => {
        const moduleFixture = await Test.createTestingModule({
            imports: [AppModule, IdempotencyModule, SequenceModule],
            controllers: [TestIdempotencyController],
        }).compile();
        app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        configureApp(app);
        await app.init();
        prisma = app.get(PrismaService);
        runner = app.get(TransactionRunner);
        sequence = app.get(BusinessSequenceService);
        idempotency = app.get(IdempotencyService);
    });

    afterAll(async () => {
        await app.close();
    });

    async function login(account = "guojun"): Promise<string> {
        const res = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account, password: "123456" },
        });
        expect(res.statusCode).toBe(200);
        return res.json().data.accessToken;
    }

    describe("UTC 时区闭环", () => {
        it("池内多条连接的会话时区均为 +00:00（不只第一条）", async () => {
            // 池 connectionLimit=5，并发 10 个查询迫使复用全部连接
            const rows = await Promise.all(
                Array.from(
                    { length: 10 },
                    () => prisma.$queryRaw<Array<{ tz: string }>>`SELECT @@session.time_zone tz`,
                ),
            );
            const timezones = rows.flat().map(row => row.tz);
            expect(timezones).toHaveLength(10);
            for (const tz of timezones) {
                expect(tz).toBe("+00:00");
            }
        });

        it("已知 Date 写入 → 原始 SQL 字面量 → Prisma 回读三方一致", async () => {
            const marker = new Date();
            const requestHash = idempotency.digest({ method: "POST", body: { tz: "check" } });
            await runner.run(async tx => {
                await idempotency.beginOrReplay(tx, {
                    actorId: 1n,
                    operationKey: "tz:check",
                    key: `tz-check-${marker.getTime()}`,
                    requestHash,
                });
            });

            const literal = await prisma.$queryRaw<Array<{ raw: string }>>`
                SELECT CAST(created_at AS CHAR) raw FROM api_idempotency
                WHERE operation_key = 'tz:check'
            `;
            const readBack = await prisma.apiIdempotency.findFirst({
                where: { operationKey: "tz:check" },
                select: { createdAt: true },
            });

            // 三方一致：库内字面量 = Prisma 回读时刻的 UTC 化形式，且写入发生在测试期内
            const readBackLiteral = readBack!.createdAt.toISOString().slice(0, 23).replace("T", " ");
            expect(literal[0].raw).toBe(readBackLiteral);
            expect(Math.abs(readBack!.createdAt.getTime() - marker.getTime())).toBeLessThan(5000);
        });
    });

    describe("业务取号（biz_sequence 行锁）", () => {
        it("N 并发取号：序号连续且无重复", async () => {
            const results = await Promise.all(
                Array.from({ length: 8 }, () => runner.run(tx => sequence.nextRaw(tx, "seq:concurrent"))),
            );
            const sorted = results.map(v => Number(v)).sort((a, b) => a - b);
            expect(new Set(sorted).size).toBe(8);
            for (let i = 1; i < sorted.length; i++) {
                expect(sorted[i] - sorted[i - 1]).toBe(1);
            }
        });

        it("取号后事务回滚，下一次仍取到同一号码（取号与业务同事务）", async () => {
            const first = await runner.run(tx => sequence.nextRaw(tx, "seq:rollback"));
            await runner
                .run(async tx => {
                    const value = await sequence.nextRaw(tx, "seq:rollback");
                    expect(value).toBe(first + 1n);
                    throw new Error("模拟业务失败，事务回滚");
                })
                .catch(() => undefined);
            const third = await runner.run(tx => sequence.nextRaw(tx, "seq:rollback"));
            expect(third).toBe(first + 1n);
        });
    });

    describe("幂等 HTTP 层（测试专用 Controller）", () => {
        it("缺失 Idempotency-Key 返回 400", async () => {
            const token = await login();
            const res = await app.inject({
                method: "POST",
                url: "/api/test/idempotent/orders",
                headers: { authorization: `Bearer ${token}` },
                payload: {},
            });
            expect(res.statusCode).toBe(400);
            expect(res.json().message).toContain("Idempotency-Key");
        });

        it("同 key 同 body 顺序重试：重放原响应，号码只消耗一个", async () => {
            const token = await login();
            const headers = { authorization: `Bearer ${token}`, "idempotency-key": "replay-key-0001" };
            // 共享测试库被多套件串行消耗同一序列，断言改为相对增量（不依赖绝对值）
            const readNext = async (): Promise<number> => {
                const rows = await prisma.$queryRaw<Array<{ next_value: bigint }>>`
                    SELECT next_value FROM biz_sequence WHERE sequence_key = 'customer:global'
                `;
                // 序列行由首次取号懒创建：customers 套件未先行时行缺失，基准按 0
                return Number(rows[0]?.next_value ?? 0n);
            };
            const before = await readNext();
            const first = await app.inject({
                method: "POST",
                url: "/api/test/idempotent/orders",
                headers,
                payload: { payload: "a" },
            });
            expect(first.statusCode).toBe(200);
            const second = await app.inject({
                method: "POST",
                url: "/api/test/idempotent/orders",
                headers,
                payload: { payload: "a" },
            });
            expect(second.statusCode).toBe(200);
            expect(second.json().data).toEqual(first.json().data);
            // 重放不重新执行业务：全局客户序列只前进一次
            expect(await readNext()).toBe(before + 1);
        });

        it("同 key 并发请求：恰一次提交业务效果，另一方拿到重放", async () => {
            const token = await login();
            const headers = { authorization: `Bearer ${token}`, "idempotency-key": "race-key-00002" };
            const readNext = async (): Promise<number> => {
                const rows = await prisma.$queryRaw<Array<{ next_value: bigint }>>`
                    SELECT next_value FROM biz_sequence WHERE sequence_key = 'customer:global'
                `;
                // 序列行由首次取号懒创建：customers 套件未先行时行缺失，基准按 0
                return Number(rows[0]?.next_value ?? 0n);
            };
            const before = await readNext();
            const [a, b] = await Promise.all([
                app.inject({ method: "POST", url: "/api/test/idempotent/orders", headers, payload: { payload: "x" } }),
                app.inject({ method: "POST", url: "/api/test/idempotent/orders", headers, payload: { payload: "x" } }),
            ]);
            expect(a.statusCode).toBe(200);
            expect(b.statusCode).toBe(200);
            expect(a.json().data).toEqual(b.json().data);
            expect(await readNext()).toBe(before + 1); // 只新增一次
        });

        it("同 key 不同请求体：409", async () => {
            const token = await login();
            const headers = { authorization: `Bearer ${token}`, "idempotency-key": "conflict-key-003" };
            const first = await app.inject({
                method: "POST",
                url: "/api/test/idempotent/orders",
                headers,
                payload: { payload: "original" },
            });
            expect(first.statusCode).toBe(200);
            const conflict = await app.inject({
                method: "POST",
                url: "/api/test/idempotent/orders",
                headers,
                payload: { payload: "different" },
            });
            expect(conflict.statusCode).toBe(409);
            expect(conflict.json().message).toContain("幂等键");
        });

        it("同 key 同 body 不同路径参数（不同 operation）：互不冲突，各自成功", async () => {
            const token = await login();
            const headers = { authorization: `Bearer ${token}`, "idempotency-key": "same-key-00004" };
            const [orders, customers] = await Promise.all([
                app.inject({ method: "POST", url: "/api/test/idempotent/orders", headers, payload: { payload: "s" } }),
                app.inject({
                    method: "POST",
                    url: "/api/test/idempotent/customers",
                    headers,
                    payload: { payload: "s" },
                }),
            ]);
            expect(orders.statusCode).toBe(200);
            expect(customers.statusCode).toBe(200);
            expect(orders.json().data.code).not.toBe(customers.json().data.code);
        });

        it("不同 actor 使用同 key：互不冲突", async () => {
            const [superToken, staffToken] = await Promise.all([login("guojun"), login("test")]);
            const [a, b] = await Promise.all([
                app.inject({
                    method: "POST",
                    url: "/api/test/idempotent/orders",
                    headers: { authorization: `Bearer ${superToken}`, "idempotency-key": "actor-key-0005" },
                    payload: { payload: "actor" },
                }),
                app.inject({
                    method: "POST",
                    url: "/api/test/idempotent/orders",
                    headers: { authorization: `Bearer ${staffToken}`, "idempotency-key": "actor-key-0005" },
                    payload: { payload: "actor" },
                }),
            ]);
            expect(a.statusCode).toBe(200);
            expect(b.statusCode).toBe(200);
            expect(a.json().data.code).not.toBe(b.json().data.code);
        });
    });

    describe("真实死锁（原生连接制造 ER 1213）", () => {
        it("runner 识别 adapter 抛出的真实死锁并整事务重试成功", async () => {
            // 预置 A/B 锁载体与 10 行“配重”序列：干扰连接做真实 UPDATE 使其事务更重，
            // InnoDB 死锁牺牲者选择低代价一方 → 稳定选中轻量的被测事务
            await runner.run(async tx => {
                for (let i = 0; i < 10; i++) {
                    await sequence.nextRaw(tx, `deadlock:pad:${i}`);
                }
                await sequence.nextRaw(tx, "deadlock:A");
                await sequence.nextRaw(tx, "deadlock:B");
            });

            const connection = await mariadb.createConnection({
                host: process.env.DB_HOST ?? "localhost",
                port: Number.parseInt(process.env.DB_PORT ?? "3306", 10) || 3306,
                user: process.env.DB_USERNAME ?? "root",
                password: process.env.DB_PASSWORD ?? "",
                database: TEST_DATABASE,
            });

            let attempts = 0;
            try {
                const result = await withTimeout(
                    runner.run(
                        async tx => {
                            attempts++;
                            if (attempts === 1) {
                                // 被测事务（轻）：只锁 A 一行
                                await tx.$queryRaw`SELECT next_value FROM biz_sequence WHERE sequence_key = 'deadlock:A' FOR UPDATE`;
                                // 干扰连接（重）：显式事务 + 10 行真实 UPDATE + 锁 B
                                await connection.query("BEGIN");
                                for (let i = 0; i < 10; i++) {
                                    await connection.query(
                                        "UPDATE biz_sequence SET next_value = next_value + 1 WHERE sequence_key = ?",
                                        [`deadlock:pad:${i}`],
                                    );
                                }
                                await connection.query(
                                    "SELECT next_value FROM biz_sequence WHERE sequence_key = ? FOR UPDATE",
                                    ["deadlock:B"],
                                );
                                // 干扰连接异步抢 A → 与被测事务形成等待环；
                                // 被测事务随后抢 B 触发死锁检测，自身（轻）被回滚 → ER 1213
                                void sleep(60).then(() =>
                                    connection
                                        .query(
                                            "SELECT next_value FROM biz_sequence WHERE sequence_key = ? FOR UPDATE",
                                            ["deadlock:A"],
                                        )
                                        // 抢到 A（被测事务已回滚释放）后立即释放全部锁，让重试畅通
                                        .then(() => connection.query("ROLLBACK"))
                                        .catch(() => undefined),
                                );
                                await sleep(180);
                                await tx.$queryRaw`SELECT next_value FROM biz_sequence WHERE sequence_key = 'deadlock:B' FOR UPDATE`;
                            }
                            return "ok";
                        },
                        { baseDelayMs: 5, maxDelayMs: 50 },
                    ),
                    15000,
                    "真实死锁重试",
                );

                expect(result).toBe("ok");
                expect(attempts).toBe(2);
            } finally {
                await connection.query("ROLLBACK").catch(() => undefined);
                await connection.end();
            }
        });
    });
});
