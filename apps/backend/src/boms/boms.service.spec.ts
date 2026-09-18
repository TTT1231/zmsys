// 覆盖物料目录模式的 BomsService：目录树下发、快照派生（modelCode/spec/明细）、
// 物料集合校验（归属/停用/单选组）、判重 409 与幂等重放、取号与品类行锁；
// 删除未引用 BOM（订单/台账引用 409、行锁、op_log 快照与幂等）
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BomsService } from "./boms.service";
import { PrismaService } from "../prisma/prisma.service";
import { TransactionRunner } from "../prisma/transaction.runner";
import { SnowflakeGenerator } from "../common/snowflake";
import { materialSetHash } from "../common/bom-spec";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { BusinessSequenceService } from "../sequence/business-sequence.service";
import type { BomCategory, BomTable } from "../generated/prisma/client";
import type { CreateBomDto } from "./dto/create-bom.dto";

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

interface ItemFixture {
    id: bigint;
    groupId: bigint;
    name: string;
    sortOrder: number;
    status: boolean;
}

interface GroupFixture {
    id: bigint;
    categoryId: bigint;
    parentId: bigint | null;
    kind: "SECTION" | "GROUP";
    name: string;
    groupKey: string | null;
    multi: boolean | null;
    qty?: boolean | null;
    sortOrder: number;
    status: boolean;
    items: ItemFixture[];
}

type CategoryFixture = BomCategory & { groups: GroupFixture[] };

/** 旋转XK2（无分区）；0.3 为停用物料，用于目录过滤与建档拒绝用例 */
const rotaryGroups = (): GroupFixture[] => [
    {
        id: 2001n,
        categoryId: 1001n,
        parentId: null,
        kind: "GROUP",
        name: "型号",
        groupKey: "model",
        multi: false,
        sortOrder: 1,
        status: true,
        items: [
            { id: 3001n, groupId: 2001n, name: "1-1", sortOrder: 1, status: true },
            { id: 3002n, groupId: 2001n, name: "2-1", sortOrder: 2, status: true },
        ],
    },
    {
        id: 2003n,
        categoryId: 1001n,
        parentId: null,
        kind: "GROUP",
        name: "银丝厚度",
        groupKey: "silver-wire-thickness",
        multi: false,
        sortOrder: 3,
        status: true,
        items: [
            { id: 3003n, groupId: 2003n, name: "0.2", sortOrder: 1, status: true },
            { id: 3004n, groupId: 2003n, name: "0.3", sortOrder: 2, status: false },
        ],
    },
    {
        id: 2007n,
        categoryId: 1001n,
        parentId: null,
        kind: "GROUP",
        name: "弹簧",
        groupKey: "spring",
        multi: false,
        sortOrder: 7,
        status: true,
        items: [{ id: 3008n, groupId: 2007n, name: "0.5", sortOrder: 1, status: true }],
    },
    {
        id: 2016n,
        categoryId: 1001n,
        parentId: null,
        kind: "GROUP",
        name: "静片",
        groupKey: "static-plate",
        multi: false,
        qty: true,
        sortOrder: 9,
        status: true,
        items: [{ id: 3031n, groupId: 2016n, name: "带点静片", sortOrder: 1, status: true }],
    },
];

/** 新微动（分区树）；“停用分区”下的启用组用于分区停用整支不可选用例 */
const microGroups = (): GroupFixture[] => [
    {
        id: 2101n,
        categoryId: 1003n,
        parentId: null,
        kind: "SECTION",
        name: "PA66塑料",
        groupKey: null,
        multi: null,
        sortOrder: 1,
        status: true,
        items: [],
    },
    {
        id: 2111n,
        categoryId: 1003n,
        parentId: 2101n,
        kind: "GROUP",
        name: "底座",
        groupKey: "base",
        multi: false,
        sortOrder: 1,
        status: true,
        items: [{ id: 3101n, groupId: 2111n, name: "二脚底座（无挡脚）", sortOrder: 1, status: true }],
    },
    {
        id: 2102n,
        categoryId: 1003n,
        parentId: null,
        kind: "SECTION",
        name: "五金件",
        groupKey: null,
        multi: null,
        sortOrder: 2,
        status: true,
        items: [],
    },
    {
        id: 2114n,
        categoryId: 1003n,
        parentId: 2102n,
        kind: "GROUP",
        name: "支架",
        groupKey: "bracket",
        multi: false,
        sortOrder: 1,
        status: true,
        items: [
            { id: 3112n, groupId: 2114n, name: "6.3支架：铜镀银", sortOrder: 1, status: true },
            { id: 3113n, groupId: 2114n, name: "6.3支架：铜镀镍", sortOrder: 2, status: true },
        ],
    },
    {
        id: 2103n,
        categoryId: 1003n,
        parentId: null,
        kind: "SECTION",
        name: "停用分区",
        groupKey: null,
        multi: null,
        sortOrder: 3,
        status: false,
        items: [],
    },
    {
        id: 2118n,
        categoryId: 1003n,
        parentId: 2103n,
        kind: "GROUP",
        name: "弹片",
        groupKey: "spring-plate",
        multi: false,
        sortOrder: 5,
        status: true,
        items: [{ id: 3127n, groupId: 2118n, name: "0.12", sortOrder: 1, status: true }],
    },
];

const mkCategories = (): CategoryFixture[] => [
    {
        id: 1001n,
        categoryKey: "rotary-switch",
        name: "旋转XK2",
        codePrefix: "XK2",
        seqWidth: 3,
        childCategories: null,
        status: true,
        rowVersion: 1n,
        createdAt: new Date(Date.UTC(2026, 8, 1)),
        updatedAt: new Date(Date.UTC(2026, 8, 1)),
        groups: rotaryGroups(),
    },
    {
        id: 1003n,
        categoryKey: "new-micro-switch",
        name: "新微动",
        codePrefix: "KW",
        seqWidth: 4,
        childCategories: null,
        status: true,
        rowVersion: 1n,
        createdAt: new Date(Date.UTC(2026, 8, 1)),
        updatedAt: new Date(Date.UTC(2026, 8, 1)),
        groups: microGroups(),
    },
    {
        id: 1006n,
        categoryKey: "dead-switch",
        name: "停用品类",
        codePrefix: "DD",
        seqWidth: 3,
        childCategories: null,
        status: false,
        rowVersion: 1n,
        createdAt: new Date(Date.UTC(2026, 8, 1)),
        updatedAt: new Date(Date.UTC(2026, 8, 1)),
        groups: [],
    },
];

interface BomItemFixture {
    bomId: bigint;
    materialId: bigint;
    groupKey: string;
    groupName: string;
    name: string;
    position: number;
}

interface Store {
    categories: CategoryFixture[];
    boms: BomTable[];
    bomItems: BomItemFixture[];
    createdBoms: Array<Record<string, unknown>>;
    createdItems: Array<Record<string, unknown>>;
    orderRefs: bigint[];
    inboundRefs: bigint[];
    adjustmentRefs: bigint[];
    opLogs: Array<Record<string, unknown>>;
}

const mkBom = (overrides: Partial<BomTable> = {}): BomTable =>
    ({
        id: 5000n,
        bomCode: "XK2010",
        categoryId: 1001n,
        specHash: Buffer.from(
            materialSetHash([
                { id: "3003", quantity: 1 },
                { id: "3008", quantity: 1 },
            ]),
        ),
        unit: "个",
        status: true,
        rowVersion: 1n,
        requestKey: "req-existing",
        createdBy: 1n,
        updatedBy: 1n,
        createdAt: new Date(Date.UTC(2026, 8, 1, 4)),
        updatedAt: new Date(Date.UTC(2026, 8, 1, 4)),
        ...overrides,
    }) as unknown as BomTable;

/**
 * 内存事务客户端：直通实现 service 触碰的 Prisma 面。listCategories 的
 * include 过滤（品类/组 status 与物料 status where）在 mock 内忠实执行。
 */
const createStore = (store: Store) => {
    const tx = {
        $queryRaw: vi.fn(async (..._parts: unknown[]): Promise<unknown[]> => []),
        bomCategory: {
            findUnique: vi.fn(
                async ({ where }: { where: { name?: string; id?: bigint } }) =>
                    store.categories.find(category =>
                        where.name !== undefined ? category.name === where.name : category.id === where.id,
                    ) ?? null,
            ),
        },
        materialGroup: {
            findMany: vi.fn(
                async ({ where }: { where: { categoryId: bigint } }) =>
                    store.categories.find(category => category.id === where.categoryId)?.groups ?? [],
            ),
        },
        bomTable: {
            findFirst: vi.fn(
                async ({ where }: { where: { categoryId: bigint; specHash: Uint8Array } }) =>
                    store.boms.find(
                        bom =>
                            bom.categoryId === where.categoryId &&
                            Buffer.compare(
                                bom.specHash as Buffer,
                                Buffer.from(where.specHash as unknown as Uint8Array),
                            ) === 0,
                    ) ?? null,
            ),
            findUnique: vi.fn(
                async ({ where }: { where: { bomCode: string } }) =>
                    store.boms.find(bom => bom.bomCode === where.bomCode) ?? null,
            ),
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                const created = { ...data, rowVersion: 1n } as BomTable & Record<string, unknown>;
                store.boms.push(created);
                store.createdBoms.push(data);
                return created;
            }),
            delete: vi.fn(async ({ where }: { where: { id: bigint } }) => {
                const index = store.boms.findIndex(bom => bom.id === where.id);
                if (index >= 0) {
                    store.boms.splice(index, 1);
                }
            }),
        },
        bomItem: {
            createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
                for (const row of data) {
                    store.bomItems.push({
                        bomId: row.bomId as bigint,
                        materialId: row.materialId as bigint,
                        groupKey: row.groupKey as string,
                        groupName: row.groupName as string,
                        name: row.name as string,
                        position: row.position as number,
                    });
                    store.createdItems.push(row);
                }
            }),
            findMany: vi.fn(async ({ where }: { where: { bomId: bigint } }) =>
                store.bomItems.filter(item => item.bomId === where.bomId).map(item => ({ ...item })),
            ),
            deleteMany: vi.fn(async ({ where }: { where: { bomId: bigint } }) => {
                store.bomItems = store.bomItems.filter(item => item.bomId !== where.bomId);
            }),
        },
        // 删除 BOM 的引用计数面：订单（含已取消）与入库/调整流水（db-scheme §5.2）
        salesOrderTable: {
            count: vi.fn(
                async ({ where }: { where: { bomId: bigint } }) =>
                    store.orderRefs.filter(id => id === where.bomId).length,
            ),
        },
        inboundLedger: {
            count: vi.fn(
                async ({ where }: { where: { bomId: bigint } }) =>
                    store.inboundRefs.filter(id => id === where.bomId).length,
            ),
        },
        stockAdjustment: {
            count: vi.fn(
                async ({ where }: { where: { bomId: bigint } }) =>
                    store.adjustmentRefs.filter(id => id === where.bomId).length,
            ),
        },
        opLog: {
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                store.opLogs.push(data);
            }),
        },
    };
    const prisma = Object.assign(tx, {
        bomCategory: {
            // Object.assign 会覆盖 tx 侧同名面，事务内 deleteBom 的 by-id 查询与
            // lockCategoryByName 的 by-name 查询共用同一实现
            findUnique: tx.bomCategory.findUnique,
            findMany: vi.fn(
                async ({
                    where,
                    include,
                }: {
                    where?: { status: boolean };
                    include?: { groups?: { include?: { items?: { where?: { status: boolean } } } } };
                }) =>
                    store.categories
                        .filter(category => where?.status === undefined || category.status === where.status)
                        .map(category => ({
                            ...category,
                            groups: category.groups
                                .filter(group => group.status)
                                .map(group => ({
                                    ...group,
                                    items:
                                        include?.groups?.include?.items?.where?.status === undefined
                                            ? group.items
                                            : group.items.filter(
                                                  item =>
                                                      item.status === include!.groups!.include!.items!.where!.status,
                                              ),
                                })),
                        })),
            ),
        },
        bomTable: {
            findFirst: tx.bomTable.findFirst,
            findUnique: tx.bomTable.findUnique,
            create: tx.bomTable.create,
            delete: tx.bomTable.delete,
            findMany: vi.fn(async () =>
                [...store.boms]
                    .sort((a, b) => {
                        const byCreated = b.createdAt.getTime() - a.createdAt.getTime();
                        return byCreated !== 0 ? byCreated : b.id > a.id ? 1 : b.id < a.id ? -1 : 0;
                    })
                    .map(bom => {
                        const category = store.categories.find(item => item.id === bom.categoryId)!;
                        return {
                            ...bom,
                            category: { id: category.id, name: category.name },
                            items: store.bomItems.filter(item => item.bomId === bom.id),
                        };
                    }),
            ),
        },
    });
    return Object.assign(tx, {
        $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
        prisma,
    });
};

const mkService = (store: Store, beginOrReplay?: ReturnType<typeof vi.fn>, nextBomCode?: ReturnType<typeof vi.fn>) => {
    const ctx = createStore(store);
    const prisma = {
        $transaction: ctx.$transaction,
        $queryRaw: ctx.$queryRaw,
        bomCategory: ctx.prisma.bomCategory,
        bomTable: ctx.prisma.bomTable,
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
        nextBomCode: nextBomCode ?? vi.fn(async () => "XK2011"),
    } as unknown as BusinessSequenceService & Record<string, ReturnType<typeof vi.fn>>;
    return {
        service: new BomsService(prisma, snowflake, new TransactionRunner(prisma), idempotency, sequence),
        tx: ctx,
        idempotency,
        sequence,
        store,
    };
};

const dtoOf = (overrides: Partial<CreateBomDto> = {}): CreateBomDto =>
    ({ name: "旋转XK2", materialItemIds: ["3003", "3008"], ...overrides }) as CreateBomDto;

describe("BomsService", () => {
    let store: Store;

    beforeEach(() => {
        store = {
            categories: mkCategories(),
            boms: [],
            bomItems: [],
            createdBoms: [],
            createdItems: [],
            orderRefs: [],
            inboundRefs: [],
            adjustmentRefs: [],
            opLogs: [],
        };
    });

    describe("listCategories", () => {
        it("仅启用品类；分区/分组树、停用分区与停用物料不输出；seqWidth=3 省略", async () => {
            const { service } = mkService(store);
            const categories = await service.listCategories();
            expect(categories).toHaveLength(2);
            const rotary = categories[0]!;
            expect(rotary).toMatchObject({ key: "rotary-switch", name: "旋转XK2", codePrefix: "XK2" });
            expect(rotary).not.toHaveProperty("seqWidth");
            expect(rotary.groups.map(group => [group.kind, group.name, group.parentId])).toEqual([
                ["group", "型号", null],
                ["group", "银丝厚度", null],
                ["group", "弹簧", null],
                ["group", "静片", null],
            ]);
            expect(rotary.groups[1]!.items).toEqual([{ id: "3003", name: "0.2" }]);
            // 数量分组下发 qty=true，普通分组 qty=false，分区为 null
            expect(rotary.groups[3]).toMatchObject({ name: "静片", qty: true });
            expect(rotary.groups[0]).toMatchObject({ name: "型号", qty: false });
            const micro = categories[1]!;
            expect(micro.seqWidth).toBe(4);
            expect(micro.groups.map(group => group.name)).toEqual(["PA66塑料", "底座", "五金件", "支架"]);
            expect(micro.groups[0]).toMatchObject({ kind: "section", key: null, multi: null, items: [] });
            expect(micro.groups[3]).toMatchObject({ kind: "group", parentId: "2102", key: "bracket", multi: false });
        });
    });

    describe("listBoms", () => {
        it("由冻结快照派生：position 排序、modelCode 取 model 组、摘要“组名：物料名”、北京日", async () => {
            store.boms = [mkBom({ id: 5000n, createdAt: new Date(Date.UTC(2026, 8, 1, 4)) })];
            store.bomItems = [
                {
                    bomId: 5000n,
                    materialId: 3003n,
                    groupKey: "silver-wire-thickness",
                    groupName: "银丝厚度",
                    name: "0.2",
                    position: 2,
                },
                { bomId: 5000n, materialId: 3001n, groupKey: "model", groupName: "型号", name: "1-1", position: 1 },
            ];
            const { service } = mkService(store);
            const boms = await service.listBoms();
            expect(boms).toHaveLength(1);
            expect(boms[0]).toEqual({
                code: "XK2010",
                name: "旋转XK2",
                modelCode: "1-1",
                items: [
                    { materialId: "3001", groupKey: "model", groupName: "型号", name: "1-1", quantity: 1 },
                    {
                        materialId: "3003",
                        groupKey: "silver-wire-thickness",
                        groupName: "银丝厚度",
                        name: "0.2",
                        quantity: 1,
                    },
                ],
                spec: "型号：1-1 · 银丝厚度：0.2",
                created: "2026-09-01",
                unit: "个",
            });
        });

        it("未选 model 组时 modelCode 为空字符串", async () => {
            store.boms = [mkBom()];
            store.bomItems = [
                {
                    bomId: 5000n,
                    materialId: 3003n,
                    groupKey: "silver-wire-thickness",
                    groupName: "银丝厚度",
                    name: "0.2",
                    position: 1,
                },
            ];
            const { service } = mkService(store);
            const boms = await service.listBoms();
            expect(boms[0]!.modelCode).toBe("");
            expect(boms[0]!.spec).toBe("银丝厚度：0.2");
        });
    });

    describe("listStocks", () => {
        it("映射 v_bom_stock 行为 bomCode → 余量，BigInt 数量转为 number", async () => {
            const { service, tx } = mkService(store);
            tx.$queryRaw.mockResolvedValue([
                { bom_code: "XK2010", stock_qty: 200n },
                { bom_code: "KW001", stock_qty: 0 },
            ]);
            await expect(service.listStocks()).resolves.toEqual({ XK2010: 200, KW001: 0 });
        });
    });

    describe("createBom", () => {
        it("品类不存在或停用均 404；锁在存在性检查之后", async () => {
            const { service } = mkService(store);
            await expect(service.createBom(dtoOf({ name: "未知品类" }), actor, ID_KEY)).rejects.toThrow(
                new NotFoundException("品类不存在"),
            );
            await expect(service.createBom(dtoOf({ name: "停用品类" }), actor, ID_KEY)).rejects.toThrow(
                NotFoundException,
            );
        });

        it("空集合 / 非法 id / 未知或停用物料均 400", async () => {
            const { service } = mkService(store);
            await expect(service.createBom(dtoOf({ materialItemIds: [] }), actor, ID_KEY)).rejects.toThrow(
                new BadRequestException("请至少选择一项物料"),
            );
            await expect(service.createBom(dtoOf({ materialItemIds: ["abc"] }), actor, ID_KEY)).rejects.toThrow(
                new BadRequestException("物料编号格式无效"),
            );
            await expect(service.createBom(dtoOf({ materialItemIds: ["9999"] }), actor, ID_KEY)).rejects.toThrow(
                new BadRequestException("物料不存在、已停用或不属于该品类"),
            );
            // 停用物料（0.3）与停用分区下的物料（弹片 0.12）同样不可选
            await expect(service.createBom(dtoOf({ materialItemIds: ["3004"] }), actor, ID_KEY)).rejects.toThrow(
                new BadRequestException("物料不存在、已停用或不属于该品类"),
            );
            await expect(
                service.createBom(dtoOf({ name: "新微动", materialItemIds: ["3127"] }), actor, ID_KEY),
            ).rejects.toThrow(new BadRequestException("物料不存在、已停用或不属于该品类"));
        });

        it("单选组超过一项 400（同类部件互斥由分组结构表达）", async () => {
            const { service } = mkService(store);
            await expect(
                service.createBom(dtoOf({ name: "新微动", materialItemIds: ["3112", "3113"] }), actor, ID_KEY),
            ).rejects.toThrow(new BadRequestException("分组「支架」只能选择一项物料"));
        });

        it("数量分组（qty=1）携带 1-99 数量建档：明细/摘要/hash 均含数量", async () => {
            const { service, store: written } = mkService(store);
            const bom = await service.createBom(
                dtoOf({ materialItemIds: ["3001", "3031"], quantities: { "3031": 4 } }),
                actor,
                ID_KEY,
            );
            expect(bom.items).toEqual([
                { materialId: "3001", groupKey: "model", groupName: "型号", name: "1-1", quantity: 1 },
                { materialId: "3031", groupKey: "static-plate", groupName: "静片", name: "带点静片", quantity: 4 },
            ]);
            expect(bom.spec).toBe("型号：1-1 · 静片：带点静片 ×4");
            expect(written.createdItems.map(item => [item.materialId, item.quantity])).toEqual([
                [3001n, 1],
                [3031n, 4],
            ]);
            expect(
                Buffer.compare(
                    written.createdBoms[0]!.specHash as Buffer,
                    Buffer.from(
                        materialSetHash([
                            { id: "3001", quantity: 1 },
                            { id: "3031", quantity: 4 },
                        ]),
                    ),
                ) === 0,
            ).toBe(true);
            // 同物料集合不同数量可并存（判重输入含数量），缺省数量按 1 冻结
            const plain = await service.createBom(dtoOf({ materialItemIds: ["3001", "3031"] }), actor, "idem-key-02");
            expect(plain.items).toEqual([
                { materialId: "3001", groupKey: "model", groupName: "型号", name: "1-1", quantity: 1 },
                { materialId: "3031", groupKey: "static-plate", groupName: "静片", name: "带点静片", quantity: 1 },
            ]);
        });

        it("数量校验：qty 分组 0/100/非整数 400；非 qty 分组携带数量 400", async () => {
            const { service } = mkService(store);
            for (const bad of [0, 100, 1.5, "3" as unknown as number]) {
                await expect(
                    service.createBom(dtoOf({ materialItemIds: ["3031"], quantities: { "3031": bad } }), actor, ID_KEY),
                ).rejects.toThrow(BadRequestException);
            }
            await expect(
                service.createBom(dtoOf({ materialItemIds: ["3001"], quantities: { "3001": 2 } }), actor, ID_KEY),
            ).rejects.toThrow(new BadRequestException("分组「型号」的物料不带数量"));
        });

        it("建档成功：冻结快照按目录顺序分配 position，hash 与输入顺序无关", async () => {
            const { service, store: written } = mkService(store);
            // 输入顺序与目录顺序相反，验证 position 仍按目录序冻结
            const bom = await service.createBom(dtoOf({ materialItemIds: ["3008", "3003"] }), actor, ID_KEY);
            expect(bom).toMatchObject({
                code: "XK2011",
                name: "旋转XK2",
                modelCode: "",
                spec: "银丝厚度：0.2 · 弹簧：0.5",
                unit: "个",
            });
            expect(bom.items).toEqual([
                {
                    materialId: "3003",
                    groupKey: "silver-wire-thickness",
                    groupName: "银丝厚度",
                    name: "0.2",
                    quantity: 1,
                },
                { materialId: "3008", groupKey: "spring", groupName: "弹簧", name: "0.5", quantity: 1 },
            ]);
            expect(written.createdBoms[0]).toMatchObject({ bomCode: "XK2011", unit: "个", categoryId: 1001n });
            expect(
                Buffer.compare(
                    written.createdBoms[0]!.specHash as Buffer,
                    Buffer.from(
                        materialSetHash([
                            { id: "3003", quantity: 1 },
                            { id: "3008", quantity: 1 },
                        ]),
                    ),
                ) === 0,
            ).toBe(true);
            expect(written.createdItems.map(item => [item.materialId, item.position])).toEqual([
                [3003n, 1],
                [3008n, 2],
            ]);
        });

        it("选中 model 组物料时响应 modelCode 为其名称", async () => {
            const { service } = mkService(store);
            const bom = await service.createBom(dtoOf({ materialItemIds: ["3001", "3003"] }), actor, ID_KEY);
            expect(bom.modelCode).toBe("1-1");
            expect(bom.spec).toBe("型号：1-1 · 银丝厚度：0.2");
        });

        it("重复 id 静默去重：只落一条明细、判重不受影响", async () => {
            const { service, store: written } = mkService(store);
            const bom = await service.createBom(dtoOf({ materialItemIds: ["3003", "3003"] }), actor, ID_KEY);
            expect(bom.items).toHaveLength(1);
            expect(written.createdItems).toHaveLength(1);
        });

        it("同集合判重 409 并返回已有 bomCode（输入顺序与重复项不影响指纹）", async () => {
            store.boms = [mkBom()];
            const { service } = mkService(store);
            await expect(
                service.createBom(dtoOf({ materialItemIds: ["3008", "3003", "3003"] }), actor, ID_KEY),
            ).rejects.toThrow(new ConflictException("BOM 已存在：XK2010"));
        });

        it("取号参数携带品类元数据；建档前锁定品类行；幂等重放直接返回原响应", async () => {
            const replayBody = { code: "XK2099", name: "旋转XK2" };
            const beginOrReplay = vi.fn(async () => ({ replay: { body: replayBody }, placeholderId: null }));
            const { service, store: written } = mkService(store, beginOrReplay);
            await expect(service.createBom(dtoOf(), actor, ID_KEY)).resolves.toBe(replayBody);
            expect(written.createdBoms).toHaveLength(0);

            const nextBomCode = vi.fn(async () => "XK2012");
            const fresh = mkService(store, undefined, nextBomCode);
            await fresh.service.createBom(dtoOf({ materialItemIds: ["3001"] }), actor, ID_KEY);
            expect(nextBomCode).toHaveBeenCalledWith(expect.anything(), {
                categoryKey: "rotary-switch",
                codePrefix: "XK2",
                seqWidth: 3,
            });
            // 品类行锁在建档事务内执行（db-scheme §2：BOM 新建锁品类与其序列表）
            const calls = fresh.tx.$queryRaw.mock.calls as unknown as Array<[TemplateStringsArray]>;
            const lockSql = calls.filter(call => /bom_category.*FOR UPDATE/s.test(String(call[0] ?? "")));
            expect(lockSql.length).toBeGreaterThan(0);
        });
    });

    describe("deleteBom", () => {
        it("BOM 不存在 404；幂等键缺失 400", async () => {
            const { service } = mkService(store);
            await expect(service.deleteBom("XK2999", actor, ID_KEY)).rejects.toThrow(
                new NotFoundException("BOM 不存在"),
            );
            store.boms = [mkBom()];
            await expect(service.deleteBom("XK2010", actor, undefined)).rejects.toThrow(BadRequestException);
        });

        it("被销售订单引用（含已取消订单）一律 409，不触碰任何行", async () => {
            store.boms = [mkBom()];
            store.orderRefs = [5000n];
            const { service, store: written } = mkService(store);
            await expect(service.deleteBom("XK2010", actor, ID_KEY)).rejects.toThrow(
                new ConflictException("BOM 已被销售订单引用，不可删除"),
            );
            expect(written.boms).toHaveLength(1);
            expect(written.opLogs).toHaveLength(0);
        });

        it("存在入库或库存调整流水时 409（外键 RESTRICT 的前置友好校验）", async () => {
            store.boms = [mkBom()];
            store.inboundRefs = [5000n];
            const { service } = mkService(store);
            await expect(service.deleteBom("XK2010", actor, ID_KEY)).rejects.toThrow(
                new ConflictException("BOM 已有入库或库存调整流水，不可删除"),
            );
            store.inboundRefs = [];
            store.adjustmentRefs = [5000n];
            const again = mkService(store);
            await expect(again.service.deleteBom("XK2010", actor, ID_KEY)).rejects.toThrow(
                new ConflictException("BOM 已有入库或库存调整流水，不可删除"),
            );
        });

        it("未引用 BOM 删除成功：明细随行清理、行锁先行、op_log 记录删除前快照", async () => {
            store.boms = [mkBom()];
            store.bomItems = [
                {
                    bomId: 5000n,
                    materialId: 3003n,
                    groupKey: "silver-wire-thickness",
                    groupName: "银丝厚度",
                    name: "0.2",
                    position: 1,
                },
            ];
            const { service, tx, idempotency, store: written } = mkService(store);
            await expect(service.deleteBom("XK2010", actor, ID_KEY)).resolves.toBeNull();
            expect(written.boms).toHaveLength(0);
            expect(written.bomItems).toHaveLength(0);
            // BOM 行锁在引用校验之前（订单新建/入库登记竞争同一行锁，§2 锁序）
            const calls = tx.$queryRaw.mock.calls as unknown as Array<[TemplateStringsArray]>;
            expect(calls.some(call => /bom_table.*FOR UPDATE/s.test(String(call[0] ?? "")))).toBe(true);
            expect(written.opLogs).toHaveLength(1);
            expect(written.opLogs[0]).toMatchObject({
                action: "delete_bom",
                targetType: "bom",
                targetId: 5000n,
                targetCode: "XK2010",
            });
            expect(written.opLogs[0]!.detailJson).toMatchObject({ code: "XK2010", name: "旋转XK2" });
            expect(idempotency.complete).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ httpStatus: 200, resource: { type: "bom", code: "XK2010" } }),
            );
        });

        it("幂等重放直接返回 null，不再执行删除", async () => {
            store.boms = [mkBom()];
            const beginOrReplay = vi.fn(async () => ({
                replay: { httpStatus: 200, body: { deleted: true, code: "XK2010" } },
                placeholderId: null,
            }));
            const { service, store: written } = mkService(store, beginOrReplay);
            await expect(service.deleteBom("XK2010", actor, ID_KEY)).resolves.toBeNull();
            expect(written.boms).toHaveLength(1);
            expect(written.opLogs).toHaveLength(0);
        });
    });
});
