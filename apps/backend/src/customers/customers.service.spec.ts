import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomersService } from "./customers.service";
import { PrismaService } from "../prisma/prisma.service";
import { TransactionRunner } from "../prisma/transaction.runner";
import { SnowflakeGenerator } from "../common/snowflake";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { BusinessSequenceService } from "../sequence/business-sequence.service";
import type { CustomTable, SalesOrderTable, SysUser } from "../generated/prisma/client";

const actor = {
    id: "1",
    account: "guojun",
    name: "郭均",
    role: "super",
    isSuper: true,
    rowVersion: 1,
    permissions: new Set<string>(),
} as const;

const ID_KEY = "idem-key-01";

const mkUser = (overrides: Partial<SysUser>): SysUser =>
    ({
        id: 1n,
        account: "guojun",
        name: "郭均",
        roleCode: "super",
        status: true,
        tokenVersion: 1n,
        rowVersion: 1n,
        passwordHash: "x",
        passwordChangedAt: null,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    }) as SysUser;

/** 客户行 + service 期望的 owner 关联（内存实现直接把 owner 挂在行上） */
type CustomerRow = CustomTable & { owner: Pick<SysUser, "id" | "name" | "account"> };

const mkCustomer = (id: bigint, ownerId: bigint, overrides: Partial<CustomerRow> = {}): CustomerRow => {
    const owner = mkUser({ id: ownerId, account: `sales${ownerId}`, name: `销售${ownerId}`, roleCode: "sales" });
    return {
        id,
        customerCode: `CUS-${String(id).padStart(4, "0")}`,
        name: `客户${id}`,
        contactPerson: "联系人",
        contactPhone: "13800001111",
        province: "广东省",
        city: "深圳市",
        district: null,
        town: null,
        address: "科技园 1 号",
        ownerId,
        payTerms: "",
        rowVersion: 1n,
        requestKey: `req-${id}`,
        createdBy: 1n,
        updatedBy: 1n,
        createdAt: new Date(Date.UTC(2026, 8, 1)),
        updatedAt: new Date(),
        owner: { id: owner.id, name: owner.name, account: owner.account },
        ...overrides,
    };
};

const mkOrder = (overrides: Partial<SalesOrderTable>): SalesOrderTable =>
    ({
        id: 1n,
        orderNo: "ZM260901001",
        customerId: 900n,
        bomId: 1n,
        qty: 100,
        lifecycleStatus: "ACTIVE",
        orderDate: new Date("2026-09-01T00:00:00Z"),
        deliverDate: new Date("2026-09-20T00:00:00Z"),
        remark: "",
        customerNameSnapshot: "客户",
        bomNameSnapshot: "新微动",
        bomModelSnapshot: "KW",
        bomSpecSnapshot: {},
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        rowVersion: 1n,
        requestKey: "req",
        createdBy: 1n,
        updatedBy: 1n,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    }) as SalesOrderTable;

interface Store {
    users: Map<string, SysUser>;
    customers: CustomerRow[];
    orders: SalesOrderTable[];
    ownerHistories: unknown[];
    opLogs: unknown[];
}

/** 内存事务客户端：直通实现 service 触碰的 Prisma 面 */
const createStore = (store: Store) => {
    const applyIncrement = (row: Record<string, unknown>, data: Record<string, unknown>) => {
        const applied = { ...row, ...data } as Record<string, unknown>;
        const patch = data.rowVersion as { increment: number } | undefined;
        if (patch) {
            applied.rowVersion = (row.rowVersion as bigint) + BigInt(patch.increment);
        }
        return applied;
    };
    const tx = {
        $queryRaw: vi.fn(async () => []),
        sysUser: {
            findUnique: vi.fn(async ({ where }: { where: { account?: string; id?: bigint } }) =>
                where.account
                    ? (store.users.get(where.account) ?? null)
                    : ([...store.users.values()].find(u => u.id === where.id) ?? null),
            ),
            findMany: vi.fn(
                async ({
                    where,
                    select,
                }: {
                    where: { roleCode: string | { in: string[] }; status: boolean };
                    select?: unknown;
                }) =>
                    [...store.users.values()]
                        .filter(u => {
                            const roles = typeof where.roleCode === "string" ? [where.roleCode] : where.roleCode.in;
                            return roles.includes(u.roleCode) && u.status === where.status;
                        })
                        .map(u => (select ? { name: u.name, account: u.account } : u)),
            ),
        },
        customTable: {
            findUnique: vi.fn(
                async ({ where }: { where: { customerCode: string } }) =>
                    store.customers.find(c => c.customerCode === where.customerCode) ?? null,
            ),
            findMany: vi.fn(async () => [...store.customers]),
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                const owner = [...store.users.values()].find(u => u.id === data.ownerId)!;
                const created = {
                    ...data,
                    rowVersion: 1n,
                    owner: { id: owner.id, name: owner.name, account: owner.account },
                } as unknown as CustomerRow;
                store.customers.push(created);
                return created;
            }),
            update: vi.fn(async ({ where, data }: { where: { id: bigint }; data: Record<string, unknown> }) => {
                const index = store.customers.findIndex(c => c.id === where.id);
                if (index < 0) {
                    throw new Error("update: 客户不存在");
                }
                const applied = applyIncrement(
                    store.customers[index] as unknown as Record<string, unknown>,
                    data,
                ) as unknown as CustomerRow;
                const owner = [...store.users.values()].find(u => u.id === applied.ownerId)!;
                applied.owner = { id: owner.id, name: owner.name, account: owner.account };
                store.customers[index] = applied;
                return applied;
            }),
        },
        salesOrderTable: {
            groupBy: vi.fn(async ({ where }: { where: { lifecycleStatus: string; orderDate: { gte: Date } } }) =>
                [
                    ...new Set(
                        store.orders
                            .filter(
                                o => o.lifecycleStatus === where.lifecycleStatus && o.orderDate >= where.orderDate.gte,
                            )
                            .map(o => o.customerId),
                    ),
                ].map(customerId => ({ customerId })),
            ),
            findFirst: vi.fn(
                async ({
                    where,
                }: {
                    where: { customerId: bigint; lifecycleStatus: string; orderDate: { gte: Date } };
                }) =>
                    store.orders.find(
                        o =>
                            o.customerId === where.customerId &&
                            o.lifecycleStatus === where.lifecycleStatus &&
                            o.orderDate >= where.orderDate.gte,
                    ) ?? null,
            ),
        },
        customerOwnerHistory: {
            create: vi.fn(async ({ data }: { data: unknown }) => {
                store.ownerHistories.push(data);
                return data;
            }),
        },
        opLog: {
            create: vi.fn(async ({ data }: { data: unknown }) => {
                store.opLogs.push(data);
                return data;
            }),
        },
    };
    return Object.assign(tx, {
        $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    });
};

const mkService = (store: Store, beginOrReplay?: ReturnType<typeof vi.fn>) => {
    const tx = createStore(store);
    const prisma = {
        $transaction: tx.$transaction,
        customTable: tx.customTable,
        salesOrderTable: tx.salesOrderTable,
        sysUser: tx.sysUser,
    } as unknown as PrismaService;
    const snowflake = { next: vi.fn(() => 9000000000000000n) } as unknown as SnowflakeGenerator;
    const idempotency = {
        requireKey: vi.fn((key?: string) => {
            if (!key || key.length < 8) {
                throw new BadRequestException("Idempotency-Key 必须为 8–128 个可见 ASCII 字符");
            }
            return key;
        }),
        digest: vi.fn(() => new Uint8Array(32)),
        requestKey: vi.fn(() => "a".repeat(64)),
        beginOrReplay: beginOrReplay ?? vi.fn(async () => ({ replay: null, placeholderId: 8000000000000000n })),
        complete: vi.fn(),
    } as unknown as IdempotencyService & Record<string, ReturnType<typeof vi.fn>>;
    const sequence = {
        nextCode: vi.fn(async (_tx: unknown, type: string) => (type === "customer" ? "CUS-0042" : "ZM260912001")),
    } as unknown as BusinessSequenceService;
    return {
        service: new CustomersService(prisma, snowflake, new TransactionRunner(prisma), idempotency, sequence),
        tx,
        idempotency,
        sequence,
        store,
    };
};

const createInput = {
    name: "深圳市智造电子",
    contact: "王经理",
    phone: "13800001111",
    province: "广东省",
    city: "深圳市",
    district: "南山区",
    town: "",
    address: "科技园 1 号",
    ownerAccount: "sales01",
    payTerms: "月结 30 天",
};

describe("CustomersService.listCustomers", () => {
    it("返回掩码手机号与负责人信息；近 6 个日历月有活动订单的客户为合作中", async () => {
        const customer = mkCustomer(900n, 200n);
        const stale = mkCustomer(901n, 200n);
        const store: Store = {
            users: new Map([["sales01", mkUser({ id: 200n, account: "sales01", roleCode: "sales" })]]),
            customers: [customer, stale],
            orders: [mkOrder({ id: 1n, customerId: 900n, orderDate: new Date() })],
            ownerHistories: [],
            opLogs: [],
        };
        const { service } = mkService(store);
        const list = await service.listCustomers();
        expect(list).toHaveLength(2);
        expect(list[0]).toMatchObject({
            code: "CUS-0900",
            phone: "138****1111",
            cooperation: "合作中",
            owner: "销售200",
            ownerAccount: "sales200",
            district: "",
            created: "2026-09-01",
        });
        expect(list[1].cooperation).toBe("待跟进");
    });

    it("取消订单不计入合作状态（仅活动订单派生）", async () => {
        const store: Store = {
            users: new Map(),
            customers: [mkCustomer(900n, 200n)],
            orders: [mkOrder({ customerId: 900n, orderDate: new Date(), lifecycleStatus: "CANCELLED" as const })],
            ownerHistories: [],
            opLogs: [],
        };
        const { service } = mkService(store);
        const list = await service.listCustomers();
        expect(list[0].cooperation).toBe("待跟进");
    });
});

describe("CustomersService.listOwnerOptions", () => {
    it("仅返回启用中销售与超级管理员的展示字段", async () => {
        const store: Store = {
            users: new Map([
                ["sales01", mkUser({ id: 200n, account: "sales01", name: "销售一", roleCode: "sales" })],
                ["sales02", mkUser({ id: 201n, account: "sales02", name: "停售", roleCode: "sales", status: false })],
                ["admin01", mkUser({ id: 202n, account: "admin01", name: "管理员", roleCode: "admin" })],
                ["super01", mkUser({ id: 203n, account: "super01", name: "超级管理员", roleCode: "super" })],
            ]),
            customers: [],
            orders: [],
            ownerHistories: [],
            opLogs: [],
        };
        const { service } = mkService(store);
        const options = await service.listOwnerOptions();
        expect(options).toEqual([
            { name: "销售一", account: "sales01" },
            { name: "超级管理员", account: "super01" },
        ]);
    });
});

describe("CustomersService.revealPhone", () => {
    const salesActor = (id: string, account: string) =>
        ({
            id,
            account,
            name: "销售",
            role: "sales",
            isSuper: false,
            rowVersion: 1,
            permissions: new Set<string>(),
        }) as const;

    it("超管可取任意客户的完整手机号", async () => {
        const store: Store = {
            users: new Map(),
            customers: [mkCustomer(900n, 200n)],
            orders: [],
            ownerHistories: [],
            opLogs: [],
        };
        const { service } = mkService(store);
        await expect(service.revealPhone("CUS-0900", actor)).resolves.toEqual({ phone: "13800001111" });
    });

    it("销售可取本人负责客户；他人客户与未知客户分别 403/404", async () => {
        const store: Store = {
            users: new Map(),
            customers: [mkCustomer(900n, 200n)],
            orders: [],
            ownerHistories: [],
            opLogs: [],
        };
        const { service } = mkService(store);
        const owner = salesActor("200", "sales200");
        await expect(service.revealPhone("CUS-0900", owner)).resolves.toEqual({ phone: "13800001111" });

        const stranger = salesActor("201", "sales201");
        await expect(service.revealPhone("CUS-0900", stranger)).rejects.toThrow(
            new ForbiddenException("只有超级管理员或客户负责人可获取完整手机号"),
        );
        await expect(service.revealPhone("CUS-9999", actor)).rejects.toThrow(new NotFoundException("客户不存在"));
    });
});

describe("CustomersService.createCustomer", () => {
    let store: Store;
    let ctx: ReturnType<typeof mkService>;

    beforeEach(() => {
        store = {
            users: new Map([["sales01", mkUser({ id: 200n, account: "sales01", roleCode: "sales" })]]),
            customers: [],
            orders: [],
            ownerHistories: [],
            opLogs: [],
        };
        ctx = mkService(store);
    });

    it("创建成功：全局取号、落库完整号码、写 op_log、登记幂等响应（合作状态为待跟进）", async () => {
        const created = await ctx.service.createCustomer(createInput, actor, ID_KEY);
        expect(created).toMatchObject({
            code: "CUS-0042",
            phone: "138****1111",
            cooperation: "待跟进",
            ownerAccount: "sales01",
        });
        expect(store.customers).toHaveLength(1);
        expect(store.customers[0].contactPhone).toBe("13800001111");
        expect(store.opLogs).toHaveLength(1);
        expect(ctx.idempotency.complete).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ httpStatus: 200, resource: { type: "customer", code: "CUS-0042" } }),
        );
    });

    it("省市地址留空可建档：空串规范化为 NULL，响应回空串", async () => {
        const created = await ctx.service.createCustomer(
            { ...createInput, province: "", city: "", district: "", town: "", address: "" },
            actor,
            ID_KEY,
        );
        expect(store.customers[0]).toMatchObject({ province: null, city: null, address: null });
        expect(created).toMatchObject({ province: "", city: "", address: "" });
    });

    it("负责人不存在返回 404；非销售/超级管理员或停用账号返回 400", async () => {
        await expect(ctx.service.createCustomer(createInput, actor, ID_KEY)).resolves.toBeDefined();
        await expect(
            ctx.service.createCustomer({ ...createInput, ownerAccount: "nobody" }, actor, ID_KEY),
        ).rejects.toThrow(new NotFoundException("负责人账号不存在"));
        store.users.set("clerk", mkUser({ id: 100n, account: "clerk", roleCode: "staff" }));
        await expect(
            ctx.service.createCustomer({ ...createInput, ownerAccount: "clerk" }, actor, ID_KEY),
        ).rejects.toThrow(new BadRequestException("客户负责人必须是启用中的销售或超级管理员账号"));
    });

    it("幂等键非法返回 400 不触碰数据库；重放直接返回首次响应", async () => {
        await expect(ctx.service.createCustomer(createInput, actor, "short")).rejects.toThrow(BadRequestException);
        expect(ctx.tx.customTable.create).not.toHaveBeenCalled();

        const replayBody = { version: 1, code: "CUS-0042" };
        const local = mkService(
            store,
            vi.fn(async () => ({ replay: { httpStatus: 200, body: replayBody }, placeholderId: null })),
        );
        const result = await local.service.createCustomer(createInput, actor, ID_KEY);
        expect(result).toEqual(replayBody);
        expect(local.tx.customTable.create).not.toHaveBeenCalled();
    });
});

describe("CustomersService.updateCustomer", () => {
    let store: Store;
    let ctx: ReturnType<typeof mkService>;

    beforeEach(() => {
        store = {
            users: new Map([
                ["sales200", mkUser({ id: 200n, account: "sales200", roleCode: "sales" })],
                ["sales201", mkUser({ id: 201n, account: "sales201", name: "新销售", roleCode: "sales" })],
            ]),
            customers: [mkCustomer(900n, 200n)],
            orders: [],
            ownerHistories: [],
            opLogs: [],
        };
        ctx = mkService(store);
    });

    const updateInput = {
        expectedVersion: 1,
        name: "深圳市智造电子有限公司",
        contact: "王经理",
        phone: "",
        province: "广东省",
        city: "深圳市",
        district: "南山区",
        town: "",
        address: "科技园 2 号",
        ownerAccount: "sales200",
        payTerms: "月结 60 天",
    };

    it("客户不存在返回 404；版本不匹配返回 409", async () => {
        await expect(ctx.service.updateCustomer("CUS-9999", updateInput, actor)).rejects.toThrow(
            new NotFoundException("客户不存在"),
        );
        await expect(
            ctx.service.updateCustomer("CUS-0900", { ...updateInput, expectedVersion: 5 }, actor),
        ).rejects.toThrow(ConflictException);
    });

    it("phone 空串保留原号码；版本 +1", async () => {
        const updated = await ctx.service.updateCustomer("CUS-0900", updateInput, actor);
        expect(updated).toMatchObject({ version: 2, payTerms: "月结 60 天" });
        expect(store.customers[0].contactPhone).toBe("13800001111");
        expect(updated.phone).toBe("138****1111");
    });

    it("phone 提交完整号码则更新；负责人变化写移交历史；编辑后合作状态按活动订单派生", async () => {
        store.orders.push(mkOrder({ id: 1n, customerId: 900n, orderDate: new Date() }));
        const updated = await ctx.service.updateCustomer(
            "CUS-0900",
            { ...updateInput, phone: "13900002222", ownerAccount: "sales201" },
            actor,
        );
        expect(updated.phone).toBe("139****2222");
        expect(updated.ownerAccount).toBe("sales201");
        expect(updated.cooperation).toBe("合作中");
        expect(store.customers[0].contactPhone).toBe("13900002222");
        expect(store.ownerHistories).toHaveLength(1);
        expect(store.ownerHistories[0]).toMatchObject({ fromOwnerId: 200n, toOwnerId: 201n });
        // 审计清单：编辑动作留变更字段前后值；手机号只记"是否变更"不落明文
        expect(store.opLogs).toHaveLength(1);
        expect(store.opLogs[0]).toMatchObject({ action: "update_customer", targetCode: "CUS-0900" });
        const detail = (store.opLogs[0] as { detailJson: { phoneChanged: boolean; ownerChanged: unknown } }).detailJson;
        expect(detail.phoneChanged).toBe(true);
        expect(detail.ownerChanged).toMatchObject({ from: expect.any(String), to: "新销售" });
    });

    it("负责人未变化不写移交历史；负责人不存在 404", async () => {
        await ctx.service.updateCustomer("CUS-0900", updateInput, actor);
        expect(store.ownerHistories).toHaveLength(0);
        await expect(
            ctx.service.updateCustomer(
                "CUS-0900",
                { ...updateInput, expectedVersion: 2, ownerAccount: "nobody" },
                actor,
            ),
        ).rejects.toThrow(new NotFoundException("负责人账号不存在"));
    });
});
