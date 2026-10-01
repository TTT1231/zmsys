import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { Tx } from "../prisma/transaction.runner";
import { SnowflakeGenerator } from "../common/snowflake";
import { materialSetHash } from "../common/bom-spec";
import { bomItemsSnapshotOf, toBomItemViews } from "../common/bom-display";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { BusinessSequenceService } from "../sequence/business-sequence.service";
import { recordOpLog } from "../domain/op-log";
import { formatDateColumn } from "../common/datetime";
import { lockRowsById } from "../domain/concurrency";
import { stockByBomCodeMap } from "../domain/inventory";
import type { Bom, BomCategory, BomCatalogNode, BomStockLedger, StockFlowRow } from "./types";
import { resolveMaterialSelection, type CatalogEntry } from "./bom-rules";
import type { CreateBomDto } from "./dto/create-bom.dto";
import type { AuthUser } from "../common/types/auth-user";
import type { BomCategory as BomCategoryRow, BomTable, MaterialGroup } from "../generated/prisma/client";

/** api_idempotency 的 operation_key，与前端 mock 同粒度 */
const CREATE_OPERATION_KEY = "boms:create";
const DELETE_OPERATION_KEY = "boms:delete";

type CategoryRowWithGroups = BomCategoryRow & { groups: CatalogNodeRow[] };

type BomItemRow = {
    materialId: bigint;
    groupKey: string;
    groupName: string;
    name: string;
    position: number;
    quantity?: number;
};

type BomRowWithItems = BomTable & {
    category: { name: string };
    creator: { name: string };
    items: BomItemRow[];
};

/** bom_category.child_categories 的存储形态：JSON 数组存品类 key */
const childCategoriesOf = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === "string");
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
        if (node.kind !== "SECTION") {
            nodes.push({ isSection: false, node });
            continue;
        }
        nodes.push({ isSection: true, node });
        nodes.push(
            ...groups
                .filter(group => group.kind === "GROUP" && group.status && group.parentId === node.id)
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
        private readonly idempotency: IdempotencyService,
        private readonly sequence: BusinessSequenceService,
    ) {}

    /** 品类目录（契约 bom:view）：仅启用品类与启用目录节点，目录修改只走数据库迁移。
     * 旋转变体（焊线/插线）等「目录容器品类」停用后不出现在建档下拉，但被启用
     * 品类的 child_categories 引用，仍随本接口下发（status=false）供前端合并目录。 */
    async listCategories(): Promise<BomCategory[]> {
        // 一次取全量品类，内存按启用位与 child 引用分流（免第二段容器品类查询）；
        // items 只取展示所需列。输出集合与旧两段查询等价：启用品类 + 被启用品类
        // 引用的容器品类（可能停用如焊线/插线，启用者去重）
        const all = await this.prisma.bomCategory.findMany({
            orderBy: { id: "asc" },
            include: {
                groups: {
                    include: {
                        items: {
                            where: { status: true },
                            select: { id: true, name: true, sortOrder: true, status: true },
                        },
                    },
                },
            },
        });
        const enabled = all.filter(row => row.status);
        const enabledIds = new Set(enabled.map(row => row.id.toString()));
        const childKeys = new Set(enabled.flatMap(row => childCategoriesOf(row.childCategories).filter(Boolean)));
        const containers = all.filter(row => childKeys.has(row.categoryKey) && !enabledIds.has(row.id.toString()));
        return [...enabled, ...containers].sort((a, b) => (a.id < b.id ? -1 : 1)).map(row => this.toCategory(row));
    }

    /**
     * BOM 档案列表（契约 bom:view）：全量返回（契约无分页），新建置顶。
     * 明细、modelCode 与摘要全部取自建档冻结快照，不读当前目录。
     */
    async listBoms(): Promise<Bom[]> {
        const rows = await this.prisma.bomTable.findMany({
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            include: { category: { select: { name: true } }, creator: { select: { name: true } }, items: true },
        });
        return rows.map(row => this.toBom(row));
    }

    /**
     * BOM 库存余量聚合（契约 bom:view）：v_bom_stock 视图直查，供列表页
     * 库存列使用，免前端拉全量台账推导；仅返回存在流水的 BOM，无流水者
     * 由前端按 0 展示。
     */
    async listStocks(): Promise<Record<string, number>> {
        return Object.fromEntries(await stockByBomCodeMap(this.prisma));
    }

    /**
     * BOM 出入库流水（契约 bom:view）：入库/调整/出库三台账与 v_bom_stock 同一
     * 口径合并（有效入库 + 全量调整 − 有效出库）；出库臂取 v_outbound_effective_event
     * 的全部事件（未软删单，含作废单的正向与冲销行），结余与 v_bom_stock 恒等
     * 不依赖"作废必等额冲销"的隐式零和——未来部分冲销时作废单残值即实际出库，
     * 同样进入流水与结余。冲销行的备注展示作废原因（视图 remark 列）。
     * 业务日升序返回并逐笔累计结余；同日内按操作时间排序（单号字母序会把出库
     * 排在先发生的入库前，结余出现与可发量校验矛盾的负数中间值）；BOM 不存在 404。
     */
    async stockLedger(code: string): Promise<BomStockLedger> {
        const bom = await this.prisma.bomTable.findUnique({
            where: { bomCode: code },
            select: { id: true },
        });
        if (!bom) {
            throw new NotFoundException("BOM 不存在");
        }
        const rows = await this.prisma.$queryRaw<
            Array<{
                no: string;
                biz_date: Date;
                created_at: Date;
                qty: bigint | number;
                type: string;
                operator: string;
                remark: string;
                customer: string | null;
            }>
        >`
            SELECT flow.no, flow.biz_date, flow.created_at, flow.qty, flow.type, flow.operator, flow.remark,
                   flow.customer
            FROM (
                SELECT i.entry_no AS no, i.business_date AS biz_date, i.created_at, CAST(i.qty AS SIGNED) AS qty,
                       'in' AS type, u.name AS operator, i.remark, NULL AS customer
                FROM inbound_ledger AS i
                JOIN sys_user AS u ON u.id = i.operator_id
                WHERE i.bom_id = ${bom.id} AND i.status = 'ACTIVE'
                UNION ALL
                SELECT a.adjustment_no, a.business_date, a.created_at, a.qty_delta, 'adjust', u.name, a.reason,
                       NULL
                FROM stock_adjustment AS a
                JOIN sys_user AS u ON u.id = a.operator_id
                WHERE a.bom_id = ${bom.id}
                UNION ALL
                SELECT e.shipment_no, e.business_date, e.created_at, -e.qty_delta, 'out', e.operator, e.remark,
                       e.customer
                FROM v_outbound_effective_event AS e
                WHERE e.bom_id = ${bom.id}
            ) AS flow
            ORDER BY flow.biz_date ASC, flow.created_at ASC, flow.no ASC
        `;
        let balance = 0;
        const flows = rows.map(row => {
            balance += Number(row.qty);
            const flow: StockFlowRow = {
                type: row.type as StockFlowRow["type"],
                no: row.no,
                date: formatDateColumn(row.biz_date),
                qty: Number(row.qty),
                balance,
                operator: row.operator,
                remark: row.remark,
            };
            // 只有出库行带客户（订单建档快照）；入库/调整没有客户，字段省略
            if (row.type === "out" && row.customer) flow.customer = row.customer;
            return flow;
        });
        return { bomCode: code, stockQty: balance, flows };
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
        return this.idempotency.runGuarded(
            {
                actorId: BigInt(actor.id),
                operationKey: CREATE_OPERATION_KEY,
                idempotencyKey,
                digest: { method: "POST", body: dto },
            },
            async (tx: Tx, { idempotencyKey: key }) => {
                const category = await this.lockCategoryByName(tx, dto.name);
                const childCategories = childCategoriesOf(category.childCategories);
                let childCategoryRow: BomCategoryRow | null = null;
                if (childCategories.length > 0) {
                    if (!dto.childCategory) {
                        throw new BadRequestException("请选择微动开关类型");
                    }
                    if (!childCategories.includes(dto.childCategory)) {
                        throw new BadRequestException("微动开关类型不在本品类允许范围内");
                    }
                    childCategoryRow = await tx.bomCategory.findUnique({ where: { categoryKey: dto.childCategory } });
                    // 目录容器品类（焊线/插线）停用仅表示不出现在建档下拉，仍可被引用合并目录
                    if (!childCategoryRow) {
                        throw new BadRequestException("微动开关类型不存在或已停用");
                    }
                }

                const catalog = [
                    ...(await this.loadCatalog(tx, category.id)),
                    ...(childCategoryRow ? await this.loadCatalog(tx, childCategoryRow.id) : []),
                ];
                const selection = resolveMaterialSelection(catalog, dto.materialItemIds, dto.quantities);
                const hash = materialSetHash(
                    category.id,
                    selection.snapshots.map(snapshot => ({
                        id: snapshot.materialId.toString(),
                        quantity: snapshot.quantity,
                    })),
                    dto.remark ?? "",
                );

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
                        remark: dto.remark ?? "",
                        unit: "个",
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
                        quantity: snapshot.quantity,
                        createdAt: now,
                    })),
                });

                const snapshot = bomItemsSnapshotOf(selection.snapshots);
                const bom: Bom = {
                    code: bomCode,
                    name: category.name,
                    modelCode: snapshot.modelCode,
                    items: toBomItemViews(snapshot),
                    spec: snapshot.spec,
                    remark: dto.remark ?? "",
                    creator: actor.name,
                    created: now.toISOString(),
                    unit: "个",
                };
                // 审计清单：建档动作留档案快照（与 delete_bom 的详存风格一致）
                await recordOpLog(tx, this.snowflake, actor, {
                    action: "create_bom",
                    targetType: "bom",
                    targetId: bomId,
                    targetCode: bomCode,
                    detail: bom as unknown as Prisma.InputJsonValue,
                    now,
                });
                return {
                    httpStatus: 200,
                    responseBody: bom,
                    resource: { type: "bom", code: bomCode },
                };
            },
        );
    }

    /**
     * 删除未被引用的 BOM（契约 bom:delete，幂等，仅超级管理员）：清理手误建档。
     * 锁 BOM 行——订单新建与入库登记同样先锁 BOM（§2 锁序），删除与它们竞争
     * 同一行锁，先提交者生效，引用校验因此无并发窗口。命中任一引用即 409：
     * - sales_order_table：任意订单（含已取消，订单物理保留即视为引用）
     * - inbound_ledger / stock_adjustment：出入库与调整流水（外键 RESTRICT 兜底）
     * 校验通过后同事务删除 bom_item（外键要求先清子行）与 bom_table 行，
     * op_log 记录 delete_bom 与删除前快照。BOM 建档后不可修改，无乐观锁版本。
     */
    async deleteBom(code: string, actor: AuthUser, idempotencyKey: string | undefined): Promise<null> {
        // 删除的契约响应恒为 data:null：重放与成功均归一返回 null（runGuardedVoid）
        return this.idempotency.runGuardedVoid(
            {
                actorId: BigInt(actor.id),
                operationKey: DELETE_OPERATION_KEY,
                idempotencyKey,
                digest: { method: "POST", pathParams: { code } },
            },
            async (tx: Tx) => {
                const bom = await tx.bomTable.findUnique({ where: { bomCode: code } });
                if (!bom) {
                    throw new NotFoundException("BOM 不存在");
                }
                await lockRowsById(tx, "bom_table", [bom.id]);

                // 订单引用含软删行（物理清理前行仍在、FK 仍挡删），raw 计数不经软删过滤
                const [orderCount] = await tx.$queryRaw<Array<{ cnt: bigint | number }>>`
                SELECT COUNT(*) AS cnt FROM sales_order_table WHERE bom_id = ${bom.id}
            `;
                if (Number(orderCount!.cnt) > 0) {
                    throw new ConflictException("BOM 已被销售订单引用，不可删除");
                }
                // 引用计数与 fk_inbound_bom 的 ON DELETE RESTRICT 同口径：软删行物理上
                // 仍在库、外键仍会挡删，须看到已删行——raw 计数不经全局软删过滤
                // （db-scheme.md §7.1 设计说明③），物理清理后自然放行
                const [ledgerCount] = await tx.$queryRaw<Array<{ cnt: bigint | number }>>`
                SELECT (SELECT COUNT(*) FROM inbound_ledger WHERE bom_id = ${bom.id})
                     + (SELECT COUNT(*) FROM stock_adjustment WHERE bom_id = ${bom.id}) AS cnt
            `;
                if (Number(ledgerCount!.cnt) > 0) {
                    throw new ConflictException("BOM 已有入库或库存调整流水，不可删除");
                }

                const [category, creator, items] = await Promise.all([
                    tx.bomCategory.findUnique({ where: { id: bom.categoryId }, select: { name: true } }),
                    tx.sysUser.findUnique({ where: { id: bom.createdBy }, select: { name: true } }),
                    tx.bomItem.findMany({ where: { bomId: bom.id } }),
                ]);
                const snapshot = this.toBom({
                    ...bom,
                    category: { name: category?.name ?? "" },
                    creator: { name: creator?.name ?? "" },
                    items,
                });

                await tx.bomItem.deleteMany({ where: { bomId: bom.id } });
                await tx.bomTable.delete({ where: { id: bom.id } });
                const now = new Date();
                await recordOpLog(tx, this.snowflake, actor, {
                    action: "delete_bom",
                    targetType: "bom",
                    targetId: bom.id,
                    targetCode: bom.bomCode,
                    detail: snapshot as unknown as Prisma.InputJsonValue,
                    now,
                });
                // JSON 列不接受 null 占位；重放路径已归一为 null，此快照仅审计兜底
                return {
                    httpStatus: 200,
                    responseBody: { deleted: true, code: bom.bomCode },
                    resource: { type: "bom", code: bom.bomCode },
                };
            },
        );
    }

    /** 定位启用品类并锁定其行：同品类建档串行化，判重与取号在锁内无并发窗口 */ private async lockCategoryByName(
        tx: Tx,
        name: string,
    ): Promise<BomCategoryRow> {
        const located = await tx.bomCategory.findUnique({ where: { name } });
        if (!located || !located.status) {
            throw new NotFoundException("品类不存在");
        }
        // 品类表不在 LOCKABLE_TABLES：建档锁品类是单点用法，保留就地 raw SQL
        await tx.$queryRaw`SELECT id FROM bom_category WHERE id = ${located.id} FOR UPDATE`;
        return located;
    }

    /**
     * 建档可用的物料目录（树序 = 分区 → 组 → 物料的 sortOrder）：
     * 品类/分区/分组/物料任一停用即整支不可用；分区缺失（跨品类挂接或
     * 超两级目录）防御性跳过。目录锁跟随品类行锁，与建档同事务。
     */
    private async loadCatalog(tx: Tx, categoryId: bigint): Promise<CatalogEntry[]> {
        // items 只取校验/建档所需列
        const groups = (await tx.materialGroup.findMany({
            where: { categoryId },
            include: { items: { select: { id: true, name: true, sortOrder: true, status: true } } },
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
                    qty: node.qty === true,
                    name: item.name,
                });
            }
        }
        return entries;
    }

    /** 契约 BomCategory 映射：seqWidth 为 3 时省略；groups 为分区/分组扁平树（parentId 关联）；
     * status=false 标记目录容器品类（被 child 引用但不在建档下拉展示） */
    private toCategory(row: CategoryRowWithGroups): BomCategory {
        const childCategories = childCategoriesOf(row.childCategories);
        return {
            key: row.categoryKey,
            name: row.name,
            codePrefix: row.codePrefix,
            ...(row.status ? {} : { status: false }),
            ...(row.seqWidth !== 3 ? { seqWidth: row.seqWidth } : {}),
            ...(childCategories.length > 0 ? { childCategories } : {}),
            groups: orderedCatalog(row.groups).map(({ node }) => this.toNode(node)),
        };
    }

    private toNode(row: CatalogNodeRow): BomCatalogNode {
        const isGroup = row.kind === "GROUP";
        return {
            id: row.id.toString(),
            parentId: row.parentId?.toString() ?? null,
            kind: isGroup ? "group" : "section",
            name: row.name,
            key: isGroup ? row.groupKey : null,
            multi: isGroup ? row.multi : null,
            qty: isGroup ? (row.qty ?? false) : null,
            // 组内物料与建档 position 同序（sortOrder 优先，id 兜底），保证展示序与冻结快照序一致
            items: isGroup
                ? [...row.items].sort(bySiblingOrder).map(item => ({ id: item.id.toString(), name: item.name }))
                : [],
        };
    }

    /** 契约 Bom 映射：created 为北京日；modelCode/spec/明细全部由冻结快照派生；remark 为建档备注 */
    private toBom(row: BomRowWithItems): Bom {
        const snapshot = bomItemsSnapshotOf(row.items);
        return {
            code: row.bomCode,
            name: row.category.name,
            modelCode: snapshot.modelCode,
            items: toBomItemViews(snapshot),
            spec: snapshot.spec,
            remark: row.remark,
            creator: row.creator.name,
            created: row.createdAt.toISOString(),
            unit: row.unit,
        };
    }
}
