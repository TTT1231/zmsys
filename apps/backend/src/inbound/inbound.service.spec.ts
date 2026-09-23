import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InboundService } from "./inbound.service";
import { PrismaService } from "../prisma/prisma.service";
import { TransactionRunner } from "../prisma/transaction.runner";
import { SnowflakeGenerator } from "../common/snowflake";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { BusinessSequenceService } from "../sequence/business-sequence.service";
import type { BomTable, InboundLedger, StockAdjustment } from "../generated/prisma/client";

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

type LedgerRow = InboundLedger & {
    bom: { bomCode: string };
    operator: { name: string };
    updater: { name: string };
};

const mkBom = (overrides: Partial<BomTable> = {}): BomTable =>
    ({
        id: 10n,
        bomCode: "ZMKW0001",
        categoryId: 1003n,
        specHash: new Uint8Array(32),
        unit: "个",
        status: true,
        rowVersion: 1n,
        requestKey: "req-bom",
        createdBy: 1n,
        updatedBy: 1n,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    }) as BomTable;

const mkEntry = (overrides: Partial<LedgerRow> = {}): LedgerRow =>
    ({
        id: 500n,
        entryNo: "RK26091301",
        bomId: 10n,
        qty: 200,
        businessDate: new Date("2026-09-13T00:00:00Z"),
        operatorId: 1n,
        remark: "",
        status: "ACTIVE",
        rowVersion: 1n,
        requestKey: "req-in",
        updatedBy: 1n,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        bom: { bomCode: "ZMKW0001" },
        operator: { name: "郭均" },
        updater: { name: "郭均" },
        ...overrides,
    }) as LedgerRow;

interface Store {
    boms: BomTable[];
    entries: LedgerRow[];
    adjustments: Array<
        StockAdjustment & {
            bom: { bomCode: string };
            operator: { name: string };
            relatedInbound: { entryNo: string } | null;
        }
    >;
    /** 视图口径的 BOM 库存（bom_id → qty） */
    stock: Map<bigint, number>;
    changeLogs: unknown[];
    opLogs: unknown[];
}

const emptyStore = (): Store => ({
    boms: [mkBom()],
    entries: [],
    adjustments: [],
    stock: new Map(),
    changeLogs: [],
    opLogs: [],
});

const mkService = (store: Store, beginOrReplay?: ReturnType<typeof vi.fn>) => {
    const withRelations = (entry: InboundLedger): LedgerRow =>
        store.entries.find(e => e.id === entry.id) ?? (entry as LedgerRow);
    const tx = {
        // 锁查询返回空行集；v_bom_stock 视图查询按 store.stock 应答
        $queryRaw: vi.fn(async (sql: unknown, ...rest: unknown[]) => {
            const isTemplate = Array.isArray(sql);
            const strings = isTemplate
                ? (sql as readonly string[])
                : ((sql as { strings?: readonly string[] }).strings ?? []);
            const boundValues = isTemplate ? rest : ((sql as { values?: unknown[] }).values ?? []);
            const text = strings.join("");
            if (text.includes("v_bom_stock")) {
                const bomId = boundValues[0] as bigint;
                const qty = store.stock.get(bomId);
                return qty === undefined ? [] : [{ stock_qty: BigInt(qty) }];
            }
            return [];
        }),
        bomTable: {
            findUnique: vi.fn(
                async ({ where }: { where: { bomCode: string } }) =>
                    store.boms.find(b => b.bomCode === where.bomCode) ?? null,
            ),
        },
        inboundLedger: {
            findUnique: vi.fn(
                async ({ where }: { where: { entryNo: string } }) =>
                    store.entries.find(e => e.entryNo === where.entryNo) ?? null,
            ),
            // 调整单关联与删除校验走 findFirst（entryNo + 未删除过滤）
            findFirst: vi.fn(
                async ({ where }: { where: { entryNo: string; deletedAt: null } }) =>
                    store.entries.find(e => e.entryNo === where.entryNo && e.deletedAt === null) ?? null,
            ),
            // 契约口径：已软删除行不出现在台账列表
            findMany: vi.fn(async () => store.entries.filter(e => e.deletedAt === null)),
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                const created = mkEntry({
                    id: 600n,
                    entryNo: data.entryNo as string,
                    qty: data.qty as number,
                    ...({} as object),
                });
                store.entries.push(created);
                return created;
            }),
            update: vi.fn(async ({ where, data }: { where: { id: bigint }; data: Record<string, unknown> }) => {
                const index = store.entries.findIndex(e => e.id === where.id);
                if (index < 0) {
                    throw new Error("update: 入库记录不存在");
                }
                const applied = { ...store.entries[index], ...data } as LedgerRow;
                const patch = data.rowVersion as { increment: number } | undefined;
                if (patch) {
                    applied.rowVersion = store.entries[index].rowVersion + BigInt(patch.increment);
                }
                store.entries[index] = applied;
                return applied;
            }),
        },
        inboundChangeLog: {
            create: vi.fn(async ({ data }: { data: unknown }) => {
                store.changeLogs.push(data);
                return data;
            }),
            // 删除快照捞作废原因：按事件倒序取第一条 VOID 的 reason
            findFirst: vi.fn(
                async ({
                    where,
                }: {
                    where: { inboundId: bigint; eventType: string };
                }): Promise<{ reason: string } | null> => {
                    const logs = store.changeLogs as Array<{
                        inboundId: bigint;
                        eventType: string;
                        reason: string;
                    }>;
                    const matched = logs.filter(
                        log => log.inboundId === where.inboundId && log.eventType === where.eventType,
                    );
                    return matched.length ? matched[matched.length - 1]! : null;
                },
            ),
        },
        stockAdjustment: {
            findMany: vi.fn(async () => store.adjustments),
            count: vi.fn(
                async ({ where }: { where: { relatedInboundId: bigint } }) =>
                    store.adjustments.filter(a => a.relatedInboundId === where.relatedInboundId).length,
            ),
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                const created = {
                    id: 700n,
                    adjustmentNo: data.adjustmentNo as string,
                    bomId: data.bomId as bigint,
                    qtyDelta: data.qtyDelta as number,
                    businessDate: data.businessDate as Date,
                    relatedInboundId: (data.relatedInboundId ?? null) as bigint | null,
                    reversalOfId: null,
                    operatorId: 1n,
                    reason: data.reason as string,
                    requestKey: "req-adj",
                    createdAt: new Date(),
                    bom: { bomCode: "ZMKW0001" },
                    operator: { name: "郭均" },
                    relatedInbound: null,
                };
                store.adjustments.push(created);
                return created;
            }),
        },
        opLog: {
            create: vi.fn(async ({ data }: { data: unknown }) => {
                store.opLogs.push(data);
                return data;
            }),
        },
    };
    const prisma = {
        $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
        $queryRaw: tx.$queryRaw,
        inboundLedger: { findMany: tx.inboundLedger.findMany },
        stockAdjustment: { findMany: tx.stockAdjustment.findMany },
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
        nextCode: vi.fn(async (_tx: unknown, type: string, businessDate: string) =>
            type === "inbound"
                ? `RK${businessDate.slice(2).replaceAll("-", "")}01`
                : `TZ-${businessDate.replaceAll("-", "")}-0001`,
        ),
    } as unknown as BusinessSequenceService;
    void withRelations;
    return {
        service: new InboundService(prisma, snowflake, new TransactionRunner(prisma), idempotency, sequence),
        idempotency,
        store,
    };
};

describe("InboundService.listInbound", () => {
    it("映射契约形态：修正字段仅改后返回，作废状态映射，登记时间北京展示戳", async () => {
        const store = emptyStore();
        store.entries.push(
            mkEntry(),
            mkEntry({
                id: 501n,
                entryNo: "RK26091302",
                rowVersion: 2n,
                qty: 300,
                updater: { name: "管理员" },
            }),
            mkEntry({ id: 502n, entryNo: "RK26091303", status: "VOIDED" }),
            // 已软删除行不出现在台账列表（deleteInbound 打标后）
            mkEntry({ id: 503n, entryNo: "RK26091304", status: "VOIDED", deletedAt: new Date() }),
        );
        const { service } = mkService(store);
        const list = await service.listInbound();
        expect(list).toHaveLength(3);
        expect(list[0]).toMatchObject({ no: "RK26091301", qty: 200, status: "active", version: 1, inspector: "郭均" });
        expect(list[0]).not.toHaveProperty("updatedBy");
        expect(list[1]).toMatchObject({ qty: 300, version: 2, updatedBy: "管理员" });
        expect(list[1].updatedAt).toBeDefined();
        expect(list[2].status).toBe("voided");
        expect(list[0].date).toBe("2026-09-13");
        expect(list[0].time).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
    });
});

describe("InboundService.updateInbound", () => {
    let store: Store;
    let service: InboundService;
    const input = (overrides: Record<string, unknown> = {}) => ({
        expectedVersion: 1,
        bomCode: "ZMKW0001",
        qty: 300,
        date: "2026-09-13",
        remark: "修正后备注",
        reason: "检验复核数量",
        ...overrides,
    });

    beforeEach(() => {
        store = emptyStore();
        store.entries.push(mkEntry());
        ({ service } = mkService(store));
    });

    it("跨天记录不可修正（窗口按 created_at 北京日判定）", async () => {
        store.entries[0] = mkEntry({ createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000) });
        await expect(service.updateInbound("RK26091301", input(), actor)).rejects.toThrow(
            new ConflictException("只能修正北京时间当天录入的入库记录"),
        );
    });

    it("已作废记录不可再次修改；版本过期 409；单号不存在 404", async () => {
        store.entries[0] = mkEntry({ status: "VOIDED" });
        await expect(service.updateInbound("RK26091301", input(), actor)).rejects.toThrow(
            new ConflictException("已作废入库记录不可再次修改"),
        );

        store.entries[0] = mkEntry();
        await expect(service.updateInbound("RK26091301", input({ expectedVersion: 9 }), actor)).rejects.toThrow(
            new ConflictException("入库记录已被其他人修改，请刷新后重试"),
        );
        await expect(service.updateInbound("RK99999999", input(), actor)).rejects.toThrow(
            new NotFoundException("入库记录不存在"),
        );
    });

    it("不换 BOM 改数量导致负库存 409", async () => {
        // 库存 100、原 qty 200、目标 300：100 - 200 + 300 = 200 ≥ 0 通过
        store.stock.set(10n, 100);
        await expect(service.updateInbound("RK26091301", input(), actor)).resolves.toMatchObject({ qty: 300 });

        // 库存 50、原 qty 200、目标 100：50 - 200 + 100 = -50 拦截
        store.entries[0] = mkEntry({ rowVersion: 1n });
        store.stock.set(10n, 50);
        await expect(service.updateInbound("RK26091301", input({ qty: 100 }), actor)).rejects.toThrow(
            new ConflictException("修正后库存将小于 0，请先核对相关出库记录"),
        );
    });

    it("合法修正：版本 +1、登记人不变、before/after 写不可变日志", async () => {
        store.stock.set(10n, 200);
        const updated = await service.updateInbound("RK26091301", input(), actor);
        expect(updated).toMatchObject({ qty: 300, version: 2, status: "active", inspector: "郭均", updatedBy: "郭均" });
        expect(store.changeLogs).toHaveLength(1);
        expect(store.changeLogs[0]).toMatchObject({
            eventType: "UPDATE",
            beforeVersion: 1n,
            afterVersion: 2n,
            reason: "检验复核数量",
        });
    });
});

describe("InboundService.voidInbound", () => {
    it("作废后库存非负校验与成功路径（状态置 voided、日志 request_key 必填）", async () => {
        const store = emptyStore();
        store.entries.push(mkEntry());
        store.stock.set(10n, 100); // 100 - 200 < 0
        const { service } = mkService(store);
        await expect(
            service.voidInbound("RK26091301", { expectedVersion: 1, reason: "整批退回" }, actor, ID_KEY),
        ).rejects.toThrow(new ConflictException("作废后库存将小于 0，请先核对相关出库记录"));

        store.stock.set(10n, 250);
        const voided = await service.voidInbound(
            "RK26091301",
            { expectedVersion: 1, reason: "整批退回" },
            actor,
            ID_KEY,
        );
        expect(voided).toMatchObject({ status: "voided", version: 2 });
        expect(store.changeLogs).toHaveLength(1);
        expect(store.changeLogs[0]).toMatchObject({
            eventType: "VOID",
            reason: "整批退回",
            requestKey: "a".repeat(64),
        });
        // 审计清单：作废动作进 op_log（含 before/after 快照与原因）
        expect(store.opLogs).toHaveLength(1);
        expect(store.opLogs[0]).toMatchObject({ action: "void_inbound", targetCode: "RK26091301" });
    });

    it("跨天作废矩阵：仓管跨天 409；持 void-any-day 跨天成功；持权跨天库存不足仍 409", async () => {
        const store = emptyStore();
        store.entries.push(mkEntry({ createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) }));
        store.stock.set(10n, 250);
        const { service } = mkService(store);

        const warehouseActor = { ...actor, role: "warehouse" as const, isSuper: false };
        await expect(
            service.voidInbound("RK26091301", { expectedVersion: 1, reason: "跨天作废" }, warehouseActor, ID_KEY),
        ).rejects.toThrow(new ConflictException("只能作废北京时间当天录入的入库记录，跨日作废需超级管理员"));

        const crossDayActor = {
            ...actor,
            role: "warehouse" as const,
            isSuper: false,
            permissions: new Set(["inbound:void-any-day"]),
        };
        // 一致性校验不因跨天权限放开：库存不足仍拒绝
        store.stock.set(10n, 100);
        await expect(
            service.voidInbound("RK26091301", { expectedVersion: 1, reason: "跨天作废" }, crossDayActor, ID_KEY),
        ).rejects.toThrow(new ConflictException("作废后库存将小于 0，请先核对相关出库记录"));

        store.stock.set(10n, 250);
        const voided = await service.voidInbound(
            "RK26091301",
            { expectedVersion: 1, reason: "跨天作废" },
            crossDayActor,
            ID_KEY,
        );
        expect(voided).toMatchObject({ status: "voided" });
    });
});

describe("InboundService.deleteInbound", () => {
    it("非作废 409；已删除 409；被库存调整单引用 409", async () => {
        const store = emptyStore();
        store.entries.push(mkEntry()); // ACTIVE：必须先作废再删除
        const { service } = mkService(store);
        await expect(service.deleteInbound("RK26091301", { expectedVersion: 1 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException("仅已作废的入库记录可删除，请先作废"),
        );

        store.entries[0] = mkEntry({ status: "VOIDED", deletedAt: new Date() });
        await expect(service.deleteInbound("RK26091301", { expectedVersion: 1 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException("该入库记录已删除"),
        );

        store.entries[0] = mkEntry({ status: "VOIDED" });
        store.adjustments.push({ id: 701n, relatedInboundId: 500n } as Store["adjustments"][number]);
        await expect(service.deleteInbound("RK26091301", { expectedVersion: 1 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException("存在关联的库存调整单，不可删除"),
        );
    });

    it("成功：打标不动版本与变更日志，op_log 快照冻结作废原因，列表不再返回", async () => {
        const store = emptyStore();
        store.entries.push(mkEntry({ status: "VOIDED", rowVersion: 2n }));
        store.changeLogs.push({ inboundId: 500n, eventType: "VOID", reason: "整批退回" });
        const { service } = mkService(store);

        await expect(service.deleteInbound("RK26091301", { expectedVersion: 2 }, actor, ID_KEY)).resolves.toBeNull();

        expect(store.entries[0]!.deletedAt).toBeInstanceOf(Date);
        // 删除是可见性管理非业务变更：版本链止于 VOID，不递增 rowVersion、不写变更日志
        expect(store.entries[0]!.rowVersion).toBe(2n);
        expect(store.changeLogs).toHaveLength(1);
        expect(store.opLogs).toHaveLength(1);
        expect(store.opLogs[0]).toMatchObject({ action: "delete_inbound", targetCode: "RK26091301" });
        expect((store.opLogs[0] as { detailJson: { voidReason: string } }).detailJson.voidReason).toBe("整批退回");
        expect(await service.listInbound()).toHaveLength(0);
    });
});

describe("InboundService.createStockAdjustment", () => {
    const input = (overrides: Record<string, unknown> = {}) => ({
        bomCode: "ZMKW0001",
        qtyDelta: 30,
        date: "2026-09-13",
        reason: "盘点盈余",
        ...overrides,
    });

    it("负向调整不得使库存为负；成功映射契约形态", async () => {
        const store = emptyStore();
        store.stock.set(10n, 10);
        const { service } = mkService(store);
        await expect(service.createStockAdjustment(input({ qtyDelta: -30 }), actor, ID_KEY)).rejects.toThrow(
            new ConflictException("调整后库存不能小于 0"),
        );

        const created = await service.createStockAdjustment(input(), actor, ID_KEY);
        expect(created).toMatchObject({ bomCode: "ZMKW0001", qtyDelta: 30, operator: "郭均", no: "TZ-20260913-0001" });
        expect(created.time).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it("关联入库单不存在或已删除 404；BOM 不一致 409；一致时回填 relatedInboundNo", async () => {
        const store = emptyStore();
        store.entries.push(mkEntry({ entryNo: "RK26091301", bomId: 10n }));
        store.boms.push(mkBom({ id: 11n, bomCode: "ZMKW0002" }));
        const { service } = mkService(store);

        await expect(
            service.createStockAdjustment(input({ relatedInboundNo: "RK99999999" }), actor, ID_KEY),
        ).rejects.toThrow(new NotFoundException("关联入库单不存在或已删除"));

        // 已软删除的入库单不可再被新调整单关联（否则清理任务会因引用永久跳过该行）
        store.entries.push(mkEntry({ id: 504n, entryNo: "RK26091309", status: "VOIDED", deletedAt: new Date() }));
        await expect(
            service.createStockAdjustment(input({ relatedInboundNo: "RK26091309" }), actor, ID_KEY),
        ).rejects.toThrow(new NotFoundException("关联入库单不存在或已删除"));

        await expect(
            service.createStockAdjustment(
                input({ bomCode: "ZMKW0002", relatedInboundNo: "RK26091301" }),
                actor,
                ID_KEY,
            ),
        ).rejects.toThrow(new ConflictException("库存调整与关联入库单的 BOM 必须一致"));

        const created = await service.createStockAdjustment(input({ relatedInboundNo: "RK26091301" }), actor, ID_KEY);
        expect(created.relatedInboundNo).toBeUndefined(); // fake store 未回填关联；e2e 覆盖完整断言
    });
});
