import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionRunner } from '../prisma/transaction.runner';
import type { Tx } from '../prisma/transaction.runner';
import { SnowflakeGenerator } from '../common/snowflake';
import { materialSetHash } from '../common/bom-spec';
import { bomItemViewsOf, bomItemsSnapshotOf } from '../common/bom-display';
import { beijingDayKey } from '../common/beijing-day';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { BusinessSequenceService } from '../sequence/business-sequence.service';
import type { Bom, BomCategory, BomCatalogNode } from './types';
import { resolveMaterialSelection, type CatalogEntry } from './bom-rules';
import type { CreateBomDto } from './dto/create-bom.dto';
import type { AuthUser } from '../common/types/auth-user';
import type { BomCategory as BomCategoryRow, BomTable, MaterialGroup } from '../generated/prisma/client';

/** api_idempotency 的 operation_key，与前端 mock 同粒度 */
const CREATE_OPERATION_KEY = 'boms:create';

type CategoryRowWithGroups = BomCategoryRow & { groups: CatalogNodeRow[] };

type BomItemRow = {
    materialId: bigint;
    groupKey: string;
    groupName: string;
    name: string;
    position: number;
};

type BomRowWithItems = BomTable & {
    category: { name: string };
    items: BomItemRow[];
};

/** bom_category.child_categories 的存储形态：JSON 数组存品类 key */
const childCategoriesOf = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === 'string');
};

/** 同级节点排序：sortOrder 优先，id 兜底（迁移种子保证稳定）；节点与物料行通用 */
const bySiblingOrder = <T extends { sortOrder: number; id: bigint }>(a: T, b: T): number =>
    a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.id < b.id ? -1 : 1;

type CatalogNodeRow = MaterialGroup & {
    items: Array<{ id: bigint; name: string; sortOrder: number; status: boolean }>;
};

/**
 * 目录树序：顶级节点（分区与根分组）按 sortOrder 混排，分区的启用分组紧随
 * （停用分区及其分组整支跳过；parentId 缺失/跨品类的分组防御性跳过）。
 * 列表输出与建档 position 分配使用同一顺序。
 */
function orderedCatalog(groups: CatalogNodeRow[]): Array<{ isSection: boolean; node: CatalogNodeRow }> {
    const nodes: Array<{ isSection: boolean; node: CatalogNodeRow }> = [];
    const topLevel = groups.filter(group => group.parentId === null && group.status).sort(bySiblingOrder);
    for (const node of topLevel) {
        if (node.kind !== 'SECTION') {
            nodes.push({ isSection: false, node });
            continue;
        }
        nodes.push({ isSection: true, node });
        nodes.push(
            ...groups
                .filter(group => group.kind === 'GROUP' && group.status && group.parentId === node.id)
                .sort(bySiblingOrder)
                .map(child => ({ isSection: false, node: child })),
        );
    }
    return nodes;
}

@Injectable()
export class BomsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly snowflake: SnowflakeGenerator,
        private readonly txRunner: TransactionRunner,
        private readonly idempotency: IdempotencyService,
        private readonly sequence: BusinessSequenceService,
    ) {}

    /** 品类目录（契约 bom:view）：仅启用品类与启用目录节点，目录修改只走数据库迁移 */
    async listCategories(): Promise<BomCategory[]> {
        const rows = await this.prisma.bomCategory.findMany({
            where: { status: true },
            orderBy: { id: 'asc' },
            include: { groups: { include: { items: { where: { status: true } } } } },
        });
        return rows.map(row => this.toCategory(row));
    }

    /**
     * BOM 档案列表（契约 bom:view）：全量返回（契约无分页），新建置顶。
     * 明细、modelCode 与摘要全部取自建档冻结快照，不读当前目录。
     */
    async listBoms(): Promise<Bom[]> {
        const rows = await this.prisma.bomTable.findMany({
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            include: { category: { select: { name: true } }, items: true },
        });
        return rows.map(row => this.toBom(row));
    }

    /**
     * BOM 库存余量聚合（契约 bom:view）：v_bom_stock 视图直查，供列表页
     * 库存列使用，免前端拉全量台账推导；仅返回存在流水的 BOM，无流水者
     * 由前端按 0 展示。
     */
    async listStocks(): Promise<Record<string, number>> {
        const rows = await this.prisma.$queryRaw<Array<{ bom_code: string; stock_qty: bigint | number }>>`
            SELECT b.bom_code, v.stock_qty
            FROM v_bom_stock AS v
            JOIN bom_table AS b ON b.id = v.bom_id
        `;
        return Object.fromEntries(rows.map(row => [row.bom_code, Number(row.stock_qty)]));
    }

    /**
     * 新建唯一 BOM（契约 bom:create，幂等）：锁品类行（db-scheme.md §2 锁序表——
     * BOM 新建锁品类与其序列表，串行化同品类建档）；物料集合按品类目录校验
     * （归属/启用/单选组）；品类标记 childCategories 时必须携带 childCategory
     * （子品类 key），该子品类的完整物料目录并入校验范围——跌倒开关的物料
     * 树 = 跌倒盖/跌倒底/钢球/翘板 + 所选微动开关品类的底座/盖子/支架等。
     * 规范化后 (category, spec_hash) 命中即 409 并返回已有 bomCode。
     * 幂等与判重分开：同键同请求摘要重放原响应，换键撞同一集合才 409。
     */
    async createBom(dto: CreateBomDto, actor: AuthUser, idempotencyKey: string | undefined): Promise<Bom> {
        const key = this.idempotency.requireKey(idempotencyKey);
        const requestHash = this.idempotency.digest({ method: 'POST', body: dto });

        return this.txRunner.run(async (tx: Tx) => {
            const { replay, placeholderId } = await this.idempotency.beginOrReplay(tx, {
                actorId: BigInt(actor.id),
                operationKey: CREATE_OPERATION_KEY,
                key,
                requestHash,
            });
            if (replay) {
                return replay.body as unknown as Bom;
            }
            if (placeholderId === null) {
                throw new Error('幂等占位缺失');
            }

            const category = await this.lockCategoryByName(tx, dto.name);
            const childCategories = childCategoriesOf(category.childCategories);
            let childCategoryRow: BomCategoryRow | null = null;
            if (childCategories.length > 0) {
                if (!dto.childCategory) {
                    throw new BadRequestException('请选择微动开关类型');
                }
                if (!childCategories.includes(dto.childCategory)) {
                    throw new BadRequestException('微动开关类型不在本品类允许范围内');
                }
                childCategoryRow = await tx.bomCategory.findUnique({ where: { categoryKey: dto.childCategory } });
                if (!childCategoryRow || !childCategoryRow.status) {
                    throw new BadRequestException('微动开关类型不存在或已停用');
                }
            }

            const catalog = [
                ...(await this.loadCatalog(tx, category.id)),
                ...(childCategoryRow ? await this.loadCatalog(tx, childCategoryRow.id) : []),
            ];
            const selection = resolveMaterialSelection(catalog, dto.materialItemIds);
            const hash = materialSetHash(selection.ids);

            const duplicate = await tx.bomTable.findFirst({
                where: { categoryId: category.id, specHash: hash },
                select: { bomCode: true },
            });
            if (duplicate) {
                throw new ConflictException(`BOM 已存在：${duplicate.bomCode}`);
            }

            const now = new Date();
            const bomCode = await this.sequence.nextBomCode(tx, {
                categoryKey: category.categoryKey,
                codePrefix: category.codePrefix,
                seqWidth: category.seqWidth,
            });
            const bomId = this.snowflake.next();
            await tx.bomTable.create({
                data: {
                    id: bomId,
                    bomCode,
                    categoryId: category.id,
                    specHash: hash,
                    unit: '个',
                    requestKey: this.idempotency.requestKey(BigInt(actor.id), CREATE_OPERATION_KEY, key),
                    createdBy: BigInt(actor.id),
                    updatedBy: BigInt(actor.id),
                    createdAt: now,
                },
            });
            // 建档冻结快照：目录后续改名/排序/停用不影响本档展示与判重
            await tx.bomItem.createMany({
                data: selection.snapshots.map(snapshot => ({
                    id: this.snowflake.next(),
                    bomId,
                    materialId: snapshot.materialId,
                    groupKey: snapshot.groupKey,
                    groupName: snapshot.groupName,
                    name: snapshot.name,
                    position: snapshot.position,
                    createdAt: now,
                })),
            });

            const snapshot = bomItemsSnapshotOf(selection.snapshots);
            const bom: Bom = {
                code: bomCode,
                name: category.name,
                modelCode: snapshot.modelCode,
                items: snapshot.items.map(({ materialId, groupKey, groupName, name }) => ({
                    materialId,
                    groupKey,
                    groupName,
                    name,
                })),
                spec: snapshot.spec,
                created: beijingDayKey(now),
                unit: '个',
            };
            await this.idempotency.complete(tx, {
                id: placeholderId,
                httpStatus: 200,
                responseBody: bom as unknown as Prisma.InputJsonValue,
                resource: { type: 'bom', code: bomCode },
            });
            return bom;
        });
    }

    /** 定位启用品类并锁定其行：同品类建档串行化，判重与取号在锁内无并发窗口 */
    private async lockCategoryByName(tx: Tx, name: string): Promise<BomCategoryRow> {
        const located = await tx.bomCategory.findUnique({ where: { name } });
        if (!located || !located.status) {
            throw new NotFoundException('品类不存在');
        }
        await tx.$queryRaw`SELECT id FROM bom_category WHERE id = ${located.id} FOR UPDATE`;
        return located;
    }

    /**
     * 建档可用的物料目录（树序 = 分区 → 组 → 物料的 sortOrder）：
     * 品类/分区/分组/物料任一停用即整支不可用；分区缺失（跨品类挂接或
     * 超两级目录）防御性跳过。目录锁跟随品类行锁，与建档同事务。
     */
    private async loadCatalog(tx: Tx, categoryId: bigint): Promise<CatalogEntry[]> {
        const groups = (await tx.materialGroup.findMany({
            where: { categoryId },
            include: { items: true },
        })) as CatalogNodeRow[];
        const entries: CatalogEntry[] = [];
        for (const { isSection, node } of orderedCatalog(groups)) {
            if (isSection || node.groupKey === null || node.multi === null) {
                continue;
            }
            for (const item of [...node.items].sort(bySiblingOrder)) {
                if (!item.status) {
                    continue;
                }
                entries.push({
                    materialId: item.id,
                    groupKey: node.groupKey,
                    groupName: node.name,
                    multi: node.multi,
                    name: item.name,
                });
            }
        }
        return entries;
    }

    /** 契约 BomCategory 映射：seqWidth 为 3 时省略；groups 为分区/分组扁平树（parentId 关联） */
    private toCategory(row: CategoryRowWithGroups): BomCategory {
        const childCategories = childCategoriesOf(row.childCategories);
        return {
            key: row.categoryKey,
            name: row.name,
            codePrefix: row.codePrefix,
            ...(row.seqWidth !== 3 ? { seqWidth: row.seqWidth } : {}),
            ...(childCategories.length > 0 ? { childCategories } : {}),
            groups: orderedCatalog(row.groups).map(({ node }) => this.toNode(node)),
        };
    }

    private toNode(row: CatalogNodeRow): BomCatalogNode {
        const isGroup = row.kind === 'GROUP';
        return {
            id: row.id.toString(),
            parentId: row.parentId?.toString() ?? null,
            kind: isGroup ? 'group' : 'section',
            name: row.name,
            key: isGroup ? row.groupKey : null,
            multi: isGroup ? row.multi : null,
            items: isGroup ? row.items.map(item => ({ id: item.id.toString(), name: item.name })) : [],
        };
    }

    /** 契约 Bom 映射：created 为北京日；modelCode/spec/明细全部由冻结快照派生 */
    private toBom(row: BomRowWithItems): Bom {
        const snapshot = bomItemsSnapshotOf(row.items);
        return {
            code: row.bomCode,
            name: row.category.name,
            modelCode: snapshot.modelCode,
            items: bomItemViewsOf(row.items),
            spec: snapshot.spec,
            created: beijingDayKey(row.createdAt),
            unit: row.unit,
        };
    }
}
