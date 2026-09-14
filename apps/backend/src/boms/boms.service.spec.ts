import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BomsService } from './boms.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionRunner } from '../prisma/transaction.runner';
import { SnowflakeGenerator } from '../common/snowflake';
import { specHash } from '../common/bom-spec';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { BusinessSequenceService } from '../sequence/business-sequence.service';
import type { BomCategory, BomTable } from '../generated/prisma/client';
import type { BomSpecField } from './types';
import type { CreateBomDto } from './dto/create-bom.dto';

const actor = {
    id: '1',
    account: 'guojun',
    name: '郭均',
    role: 'super',
    isSuper: true,
    rowVersion: 1,
    permissions: new Set<string>(),
} as const;

const ID_KEY = 'idem-key-01';

/** 真实目录的精简子集：rotary 有固定规格，new-micro-switch 有跨字段规则 */
const rotaryFields: BomSpecField[] = [
    { key: '脚位', label: '脚位', type: 'select', options: ['二脚', '三脚'], required: true },
    { key: '杆子高度', label: '杆子高度', type: 'text', defaultValue: '4.8' },
];

const microFields: BomSpecField[] = [
    {
        key: '底座',
        label: '底座',
        type: 'select',
        options: ['二脚底座（无挡脚）', '三脚底座（有挡脚）'],
        required: true,
    },
    { key: '支架', label: '支架', type: 'select', options: ['6.3支架：铜镀银', '4.8支架：铜镀镍'], required: true },
    { key: '静片', label: '静片', type: 'select', options: ['6.3静片：铜镀银', '4.8静片：铜镀镍'], required: true },
];

/** 夹具品类：specSchema 收窄为 { fields }（Prisma JsonValue 断言在构造内统一处理） */
type CategoryFixture = Partial<Omit<BomCategory, 'specSchema'>> & { specSchema?: { fields: BomSpecField[] } };

const mkCategory = (overrides: CategoryFixture = {}): BomCategory => {
    const { specSchema, ...rest } = overrides;
    return {
        id: 1001n,
        categoryKey: 'rotary-switch',
        name: '旋转开关',
        codePrefix: 'XK2',
        seqWidth: 3,
        specSchema: specSchema ?? { fields: rotaryFields },
        status: true,
        rowVersion: 1n,
        createdAt: new Date(Date.UTC(2026, 8, 1)),
        updatedAt: new Date(Date.UTC(2026, 8, 1)),
        ...rest,
    } as unknown as BomCategory;
};

interface Store {
    categories: BomCategory[];
    boms: BomTable[];
    createdBoms: Array<Record<string, unknown>>;
}

const mkBom = (overrides: Partial<BomTable> = {}): BomTable =>
    ({
        id: 5000n,
        bomCode: 'ZMXK2010',
        categoryId: 1001n,
        modelCode: '1-1',
        spec: { 脚位: '二脚' },
        specHash: Buffer.from(specHash({ 脚位: '二脚' })),
        unit: '个',
        status: true,
        rowVersion: 1n,
        requestKey: 'req-existing',
        createdBy: 1n,
        updatedBy: 1n,
        createdAt: new Date(Date.UTC(2026, 8, 1, 4)),
        updatedAt: new Date(Date.UTC(2026, 8, 1, 4)),
        ...overrides,
    }) as unknown as BomTable;

/**
 * 内存事务客户端：直通实现 service 触碰的 Prisma 面。
 * modelCode 判重按大写等值比较，模拟列 collation utf8mb4_0900_ai_ci 的大小写不敏感语义。
 */
const createStore = (store: Store) => {
    const tx = {
        $queryRaw: vi.fn(async (..._parts: unknown[]): Promise<unknown[]> => []),
        bomCategory: {
            findUnique: vi.fn(
                async ({ where }: { where: { name: string } }) =>
                    store.categories.find(category => category.name === where.name) ?? null,
            ),
            findMany: vi.fn(async ({ where }: { where?: { status: boolean } } = {}) =>
                store.categories.filter(category => where?.status === undefined || category.status === where.status),
            ),
        },
        bomTable: {
            findMany: vi.fn(async () =>
                [...store.boms]
                    .sort((a, b) => {
                        const byCreated = b.createdAt.getTime() - a.createdAt.getTime();
                        return byCreated !== 0 ? byCreated : b.id > a.id ? 1 : b.id < a.id ? -1 : 0;
                    })
                    .map(bom => {
                        const category = store.categories.find(item => item.id === bom.categoryId)!;
                        return { ...bom, category: { id: category.id, name: category.name } };
                    }),
            ),
            findFirst: vi.fn(
                async ({ where }: { where: { categoryId: bigint; modelCode: string; specHash: Uint8Array } }) =>
                    store.boms.find(
                        bom =>
                            bom.categoryId === where.categoryId &&
                            bom.modelCode.toUpperCase() === where.modelCode.toUpperCase() &&
                            Buffer.compare(
                                bom.specHash as Buffer,
                                Buffer.from(where.specHash as unknown as Uint8Array),
                            ) === 0,
                    ) ?? null,
            ),
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                const created = { ...data, rowVersion: 1n } as BomTable & Record<string, unknown>;
                store.boms.push(created);
                store.createdBoms.push(data);
                return created;
            }),
        },
    };
    return Object.assign(tx, {
        $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    });
};

const mkService = (store: Store, beginOrReplay?: ReturnType<typeof vi.fn>, nextBomCode?: ReturnType<typeof vi.fn>) => {
    const tx = createStore(store);
    const prisma = {
        $transaction: tx.$transaction,
        $queryRaw: tx.$queryRaw,
        bomCategory: tx.bomCategory,
        bomTable: tx.bomTable,
    } as unknown as PrismaService;
    const snowflake = { next: vi.fn(() => 9000000000000000n) } as unknown as SnowflakeGenerator;
    const idempotency = {
        requireKey: vi.fn((key?: string) => {
            if (!key || key.length < 8) {
                throw new BadRequestException('Idempotency-Key 必须为 8–128 个可见 ASCII 字符');
            }
            return key;
        }),
        digest: vi.fn(() => new Uint8Array(32)),
        requestKey: vi.fn(() => 'a'.repeat(64)),
        beginOrReplay: beginOrReplay ?? vi.fn(async () => ({ replay: null, placeholderId: 8000000000000000n })),
        complete: vi.fn(),
    } as unknown as IdempotencyService & Record<string, ReturnType<typeof vi.fn>>;
    const sequence = {
        nextBomCode: nextBomCode ?? vi.fn(async () => 'ZMXK2011'),
    } as unknown as BusinessSequenceService & Record<string, ReturnType<typeof vi.fn>>;
    return {
        service: new BomsService(prisma, snowflake, new TransactionRunner(prisma), idempotency, sequence),
        tx,
        idempotency,
        sequence,
        store,
    };
};

const dtoOf = (overrides: Partial<CreateBomDto> = {}): CreateBomDto =>
    ({ name: '旋转开关', modelCode: '9-9', specs: { 脚位: '三脚' }, ...overrides }) as CreateBomDto;

describe('BomsService', () => {
    let store: Store;

    beforeEach(() => {
        store = {
            categories: [
                mkCategory({}),
                mkCategory({
                    id: 1003n,
                    categoryKey: 'new-micro-switch',
                    name: '新微动',
                    codePrefix: 'KW',
                    seqWidth: 4,
                    specSchema: { fields: microFields },
                }),
                mkCategory({
                    id: 1005n,
                    categoryKey: 'dead-switch',
                    name: '停用品类',
                    codePrefix: 'DD',
                    status: false,
                }),
            ],
            boms: [],
            createdBoms: [],
        };
    });

    describe('listCategories', () => {
        it('仅返回启用品类；seqWidth 为 3 时省略、非 3 时保留；fields 透传目录元数据', async () => {
            const { service } = mkService(store);
            const categories = await service.listCategories();
            expect(categories).toHaveLength(2);
            expect(categories[0]).toMatchObject({ key: 'rotary-switch', name: '旋转开关', codePrefix: 'XK2' });
            expect(categories[0]).not.toHaveProperty('seqWidth');
            expect(categories[1]).toMatchObject({ key: 'new-micro-switch', seqWidth: 4 });
            expect(categories[0]!.fields).toEqual(rotaryFields);
        });
    });

    describe('listBoms', () => {
        it('映射契约 Bom：品类名、规格摘要过滤品类常量、created 为北京日、新建置顶', async () => {
            store.boms = [
                mkBom({ id: 5001n, createdAt: new Date(Date.UTC(2026, 8, 1, 4)) }),
                mkBom({
                    id: 5002n,
                    bomCode: 'ZMXK2011',
                    modelCode: '2-2',
                    spec: { 脚位: '二脚', 杆子高度: '4.8' },
                    specHash: Buffer.from(specHash({ 脚位: '二脚', 杆子高度: '4.8' })),
                    createdAt: new Date(Date.UTC(2026, 8, 2, 16)),
                }),
            ];
            const { service } = mkService(store);
            const boms = await service.listBoms();
            // createdAt desc：后创建的在前
            expect(boms.map(bom => bom.code)).toEqual(['ZMXK2011', 'ZMXK2010']);
            expect(boms[1]).toEqual({
                code: 'ZMXK2010',
                name: '旋转开关',
                modelCode: '1-1',
                specs: { 脚位: '二脚' },
                spec: '1-1 · 脚位 二脚',
                created: '2026-09-01',
                unit: '个',
            });
            // 品类常量（杆子高度=defaultValue 4.8）不进摘要
            expect(boms[0]!.spec).toBe('2-2 · 脚位 二脚');
        });
    });

    describe('listStocks', () => {
        it('映射 v_bom_stock 行为 bomCode → 余量，BigInt 数量转为 number', async () => {
            const { service, tx } = mkService(store);
            tx.$queryRaw.mockResolvedValue([
                { bom_code: 'ZMXK2010', stock_qty: 200n },
                { bom_code: 'ZMKW0001', stock_qty: 0 },
            ]);
            await expect(service.listStocks()).resolves.toEqual({ ZMXK2010: 200, ZMKW0001: 0 });
        });

        it('无流水的 BOM 不在视图返回中，余量映射为空对象', async () => {
            const { service } = mkService(store);
            await expect(service.listStocks()).resolves.toEqual({});
        });
    });

    describe('createBom', () => {
        it('品类不存在或停用均 404；锁在存在性检查之后', async () => {
            const { service } = mkService(store);
            await expect(service.createBom(dtoOf({ name: '未知品类' }), actor, ID_KEY)).rejects.toThrow(
                new NotFoundException('品类不存在'),
            );
            await expect(service.createBom(dtoOf({ name: '停用品类' }), actor, ID_KEY)).rejects.toThrow(
                NotFoundException,
            );
        });

        it('规格非对象 / 值非字符串 / 未定义字段均 400', async () => {
            const { service } = mkService(store);
            await expect(
                service.createBom(dtoOf({ specs: 'x' as unknown as Record<string, unknown> }), actor, ID_KEY),
            ).rejects.toThrow(new BadRequestException('规格必须是对象'));
            await expect(
                service.createBom(dtoOf({ specs: { 脚位: 3 } as unknown as Record<string, unknown> }), actor, ID_KEY),
            ).rejects.toThrow(new BadRequestException('规格值必须是字符串'));
            await expect(service.createBom(dtoOf({ specs: { 未知: 'x' } }), actor, ID_KEY)).rejects.toThrow(
                new BadRequestException('规格中包含当前品类未定义的字段'),
            );
        });

        it('必填缺失与选项无效按目录校验；空规格拒绝', async () => {
            const { service } = mkService(store);
            await expect(service.createBom(dtoOf({ specs: {} }), actor, ID_KEY)).rejects.toThrow(
                new BadRequestException('请填写规格：脚位'),
            );
            await expect(service.createBom(dtoOf({ specs: { 脚位: '百脚' } }), actor, ID_KEY)).rejects.toThrow(
                new BadRequestException('规格值无效：脚位'),
            );
            const noRequired = mkCategory({
                id: 1006n,
                categoryKey: 'free',
                name: '自由规格',
                specSchema: { fields: [{ key: '备注', label: '备注', type: 'text' }] },
            });
            store.categories.push(noRequired);
            await expect(service.createBom(dtoOf({ name: '自由规格', specs: {} }), actor, ID_KEY)).rejects.toThrow(
                new BadRequestException('请至少填写一项规格'),
            );
        });

        it('固定规格强制覆盖客户端同名值并落库；客户端只填非固定字段', async () => {
            const { service, store: written } = mkService(store);
            const bom = await service.createBom(dtoOf({ specs: { 脚位: '三脚', 杆子高度: '6.6' } }), actor, ID_KEY);
            expect(bom.specs).toEqual({ 脚位: '三脚', 杆子高度: '4.8' });
            expect(written.createdBoms[0]).toMatchObject({
                bomCode: 'ZMXK2011',
                modelCode: '9-9',
                unit: '个',
                spec: { 脚位: '三脚', 杆子高度: '4.8' },
            });
            // 固定规格无区分度，摘要只含脚位
            expect(bom.spec).toBe('9-9 · 脚位 三脚');
        });

        it('新微动支架与静片规格不一致 400', async () => {
            const { service } = mkService(store);
            await expect(
                service.createBom(
                    dtoOf({
                        name: '新微动',
                        specs: { 底座: '二脚底座（无挡脚）', 支架: '6.3支架：铜镀银', 静片: '4.8静片：铜镀镍' },
                    }),
                    actor,
                    ID_KEY,
                ),
            ).rejects.toThrow(new BadRequestException('新微动的支架与静片必须使用相同的 6.3/4.8 规格'));
        });

        it('规范化后同品类+型号+规格判重 409（型号大小写不敏感，模拟 ai_ci）', async () => {
            // 判重口径含固定规格合并：存量行与新建行都带品类常量 杆子高度=4.8
            const identitySpec = { 脚位: '三脚', 杆子高度: '4.8' };
            store.boms = [
                mkBom({ modelCode: 'AB-1', spec: identitySpec, specHash: Buffer.from(specHash(identitySpec)) }),
            ];
            const { service } = mkService(store);
            await expect(
                service.createBom(dtoOf({ modelCode: '  ab-1  ', specs: { 脚位: '三脚' } }), actor, ID_KEY),
            ).rejects.toThrow(new ConflictException('BOM 已存在：ZMXK2010'));
        });

        it('取号参数携带品类元数据；建档前锁定品类行；幂等重放直接返回原响应', async () => {
            const replayBody = { code: 'ZMXK2099', name: '旋转开关' };
            const beginOrReplay = vi.fn(async () => ({ replay: { body: replayBody }, placeholderId: null }));
            const { service } = mkService(store, beginOrReplay);
            await expect(service.createBom(dtoOf(), actor, ID_KEY)).resolves.toBe(replayBody);

            const nextBomCode = vi.fn(async () => 'ZMXK2012');
            const fresh = mkService(store, undefined, nextBomCode);
            await fresh.service.createBom(dtoOf({ modelCode: '3-3' }), actor, ID_KEY);
            expect(nextBomCode).toHaveBeenCalledWith(expect.anything(), {
                categoryKey: 'rotary-switch',
                codePrefix: 'XK2',
                seqWidth: 3,
            });
            // 品类行锁在建档事务内执行（db-scheme §2：BOM 新建锁品类与其序列表）
            const calls = fresh.tx.$queryRaw.mock.calls as unknown as Array<[TemplateStringsArray]>;
            const lockSql = calls.filter(call => /bom_category.*FOR UPDATE/s.test(String(call[0] ?? '')));
            expect(lockSql.length).toBeGreaterThan(0);
        });
    });
});
