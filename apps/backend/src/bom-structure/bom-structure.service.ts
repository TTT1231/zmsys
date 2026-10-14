import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import type { Tx } from "../prisma/transaction.runner";
import { SnowflakeGenerator } from "../common/snowflake";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { recordOpLog } from "../domain/op-log";
import { assertVersionMatches, lockRowsById } from "../domain/concurrency";
import {
    assertGroupKeysExclusive,
    assertPrefixSafe,
    validateCatalogTree,
    type CatalogTreeNode,
} from "./catalog-validator";
import { projectStructure, type ProjectionResult, type StructureOperation } from "./catalog-projector";
import type { CategoryTypeDto, DraftNodeDto } from "./dto/create-category.dto";
import type { StructureOperationDto } from "./dto/apply-structure.dto";
import type { AuthUser } from "../common/types/auth-user";
import type { BomStructureApplyResult, BomStructureCategoryCreated } from "./types";

const APPLY_OPERATION_KEY = "bom-structure:apply";
const CREATE_CATEGORY_OPERATION_KEY = "bom-structure:create-category";

/** bom_category.child_categories 的存储形态（JSON 数组存品类 key，与 boms.service 同构） */
const childKeysOf = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

type GroupRow = {
    id: bigint;
    parentId: bigint | null;
    kind: "SECTION" | "GROUP";
    name: string;
    groupKey: string | null;
    multi: boolean | null;
    qty: boolean | null;
    sortOrder: number;
    status: boolean;
    items: Array<{ id: bigint; name: string; sortOrder: number; status: boolean }>;
};

type CategoryRowWithTree = {
    id: bigint;
    categoryKey: string;
    name: string;
    codePrefix: string;
    seqWidth: number;
    childCategories: unknown;
    status: boolean;
    rowVersion: bigint;
    groups: GroupRow[];
};

/** 行 → 投影/校验共用的树形态（id 序列化为十进制串） */
const catalogTreeOf = (groups: GroupRow[]): CatalogTreeNode[] =>
    groups.map(group => ({
        id: group.id.toString(),
        parentId: group.parentId?.toString() ?? null,
        kind: group.kind,
        name: group.name,
        groupKey: group.groupKey,
        multi: group.multi,
        qty: group.qty,
        sortOrder: group.sortOrder,
        status: group.status,
        items: group.items.map(item => ({
            id: item.id.toString(),
            name: item.name,
            sortOrder: item.sortOrder,
            status: item.status,
        })),
    }));

/* 树读取统一按 (sortOrder, id) 排序：投影的相邻交换/追加末位语义依赖确定次序，
 * 与读取侧 orderedCatalogAll 一致——不排序时按主键序投影会与前端预览漂移 */
const FULL_TREE_INCLUDE = {
    groups: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: {
            items: {
                orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
                select: { id: true, name: true, sortOrder: true, status: true },
            },
        },
    },
} satisfies Prisma.BomCategoryInclude;

/** 宽松 DTO 操作 → 七态语义操作（缺必填字段即 400） */
function normalizeOperations(operations: StructureOperationDto[]): StructureOperation[] {
    return operations.map(op => {
        const require = (condition: unknown, message: string): void => {
            if (!condition) {
                throw new BadRequestException(`结构操作 ${op.type} 缺少必填字段：${message}`);
            }
        };
        switch (op.type) {
            case "add_section":
                require(op.tempId, "tempId");
                require(op.name, "name");
                return { type: "add_section", tempId: op.tempId!, name: op.name! };
            case "add_group":
                require(op.tempId, "tempId");
                require(op.name, "name");
                require(op.multi !== undefined, "multi");
                require(op.qty !== undefined, "qty");
                return {
                    type: "add_group",
                    tempId: op.tempId!,
                    name: op.name!,
                    parentId: op.parentId ?? null,
                    multi: op.multi!,
                    qty: op.qty!,
                    ...(op.items?.length
                        ? { items: op.items.map(item => ({ tempId: item.tempId, name: item.name })) }
                        : {}),
                };
            case "add_item":
                require(op.tempId, "tempId");
                require(op.groupId, "groupId");
                require(op.name, "name");
                return { type: "add_item", tempId: op.tempId!, groupId: op.groupId!, name: op.name! };
            case "hide":
            case "restore":
                require(op.targetType, "targetType");
                require(op.targetId, "targetId");
                return {
                    type: op.type,
                    targetType: op.targetType as "section" | "group" | "item",
                    targetId: op.targetId!,
                };
            case "reorder":
                require(op.targetType, "targetType");
                require(op.targetId, "targetId");
                require(op.direction, "direction");
                return {
                    type: "reorder",
                    targetType: op.targetType as "section" | "group" | "item",
                    targetId: op.targetId!,
                    direction: op.direction as "up" | "down",
                };
            case "set_rules":
                require(op.groupId, "groupId");
                require(op.multi !== undefined, "multi");
                require(op.qty !== undefined, "qty");
                return { type: "set_rules", groupId: op.groupId!, multi: op.multi!, qty: op.qty! };
            case "rename":
                require(op.targetType, "targetType");
                require(op.targetId, "targetId");
                require(op.name, "name");
                return {
                    type: "rename",
                    targetType: op.targetType as "section" | "group" | "item",
                    targetId: op.targetId!,
                    name: op.name!,
                };
            case "move":
                require(op.targetType, "targetType");
                require(op.targetId, "targetId");
                if (op.targetType === "item") {
                    require(op.parentId !== undefined && op.parentId !== null, "parentId");
                }
                return {
                    type: "move",
                    targetType: op.targetType as "group" | "item",
                    targetId: op.targetId!,
                    parentId: op.parentId ?? null,
                };
            case "remove":
                require(op.targetType, "targetType");
                require(op.targetId, "targetId");
                return {
                    type: "remove",
                    targetType: op.targetType as "section" | "group" | "item",
                    targetId: op.targetId!,
                };
            default:
                throw new BadRequestException(`未知结构操作类型：${op.type}`);
        }
    });
}

/** 新建品类草稿 → 树形态（雪花 id；分组 key 依次派生 g1..；sortOrder 按数组序） */
function draftTreeOf(drafts: DraftNodeDto[], genId: () => bigint): CatalogTreeNode[] {
    const tempToId = new Map<string, string>();
    const claim = (tempId: string): string => {
        if (tempToId.has(tempId)) {
            throw new BadRequestException(`草稿标识「${tempId}」重复`);
        }
        const id = genId().toString();
        tempToId.set(tempId, id);
        return id;
    };
    // 节点与内联物料统一预登记（物料 tempId 也在同批唯一域内）
    for (const draft of drafts) {
        claim(draft.tempId);
        for (const item of draft.items ?? []) {
            claim(item.tempId);
        }
    }
    const usedKeys = new Set<string>();
    const nodes: CatalogTreeNode[] = drafts.map(draft => {
        if (draft.kind === "SECTION") {
            if (draft.parentTempId) {
                throw new BadRequestException(`分区「${draft.name}」只能作为根节点`);
            }
            return {
                id: tempToId.get(draft.tempId)!,
                parentId: null,
                kind: "SECTION",
                name: draft.name,
                groupKey: null,
                multi: null,
                qty: null,
                sortOrder: 0,
                status: true,
                items: [],
            };
        }
        const parentId = draft.parentTempId ? (tempToId.get(draft.parentTempId) ?? null) : null;
        if (draft.parentTempId && !parentId) {
            throw new BadRequestException(`分组「${draft.name}」的上级分区不存在`);
        }
        const groupKey = (() => {
            let index = 1;
            while (usedKeys.has(`g${index}`)) {
                index += 1;
            }
            return `g${index}`;
        })();
        usedKeys.add(groupKey);
        return {
            id: tempToId.get(draft.tempId)!,
            parentId,
            kind: "GROUP",
            name: draft.name,
            groupKey,
            multi: draft.multi ?? false,
            qty: draft.qty ?? false,
            sortOrder: 0,
            status: true,
            items: (draft.items ?? []).map((item, index) => ({
                id: tempToId.get(item.tempId)!,
                name: item.name,
                sortOrder: index,
                status: true,
            })),
        };
    });
    // sortOrder 按平铺数组序：根节点与各分区子组各自归一
    const reindex = (parentId: string | null): void => {
        nodes
            .filter(node => node.parentId === parentId)
            .forEach((node, index) => {
                node.sortOrder = index;
            });
    };
    reindex(null);
    for (const node of nodes) {
        if (node.kind === "SECTION") {
            reindex(node.id);
        }
    }
    return nodes;
}

/** 唯一键冲突（并发插入窗口）转 409 友好文案；锁内预检已拦截绝大多数 */
const asUniqueConflict = (error: unknown): never => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("名称或编码与既有品类/节点冲突，请刷新后重试");
    }
    throw error;
};

/**
 * BOM 结构在线维护（db-scheme.md §5.4，openapi bom-structure tag）：仅超管。
 * 生效口径：结构变更只影响保存后新建的 BOM；旧 BOM（bom_item 冻结行）、订单快照、
 * 出入库与库存走冻结数据不动。写路径统一「幂等 → 定位 → 伙伴锁集（id 升序）→
 * 锁后重读 → 乐观锁版本 → 投影 → 全树校验 → 差分写入 → 版本 +1 → 同事务 op_log」。
 */
@Injectable()
export class BomStructureService {
    constructor(
        private readonly snowflake: SnowflakeGenerator,
        private readonly idempotency: IdempotencyService,
    ) {}

    async apply(
        dto: {
            categoryKey: string;
            expectedRowVersion: number;
            operations: StructureOperationDto[];
        },
        actor: AuthUser,
        idempotencyKey: string | undefined,
    ): Promise<BomStructureApplyResult> {
        return this.idempotency.runGuarded(
            {
                actorId: BigInt(actor.id),
                operationKey: APPLY_OPERATION_KEY,
                idempotencyKey,
                digest: { method: "POST", body: dto }, // /bom-structure/apply
            },
            async (tx: Tx) => {
                try {
                    const now = new Date();
                    const located = await tx.bomCategory.findUnique({
                        where: { categoryKey: dto.categoryKey },
                        select: { id: true },
                    });
                    if (!located) {
                        throw new NotFoundException("品类不存在");
                    }
                    // 伙伴品类锁集：建档目录会与本品类合并校验的其他品类（正向 child_categories
                    // + 反向被引用），统一 id 升序加锁——防两个超管并发改主/子品类各自通过键
                    // 检查后交叉提交；建档侧 lockCategoryTree 同协议
                    const partnerIds = await this.partnerCategoryIds(tx, located.id);
                    await lockRowsById(tx, "bom_category", [located.id, ...partnerIds]);
                    const rows = (await tx.bomCategory.findMany({
                        where: { id: { in: [located.id, ...partnerIds] } },
                        include: FULL_TREE_INCLUDE,
                    })) as unknown as CategoryRowWithTree[];
                    const category = rows.find(row => row.id === located.id);
                    if (!category) {
                        throw new NotFoundException("品类不存在");
                    }
                    assertVersionMatches(
                        category.rowVersion,
                        dto.expectedRowVersion,
                        "品类结构已被他人修改，请刷新后重试",
                    );
                    const base = catalogTreeOf(category.groups);
                    const partners = new Map(
                        rows
                            .filter(row => row.id !== category.id)
                            .map(row => [
                                row.name,
                                new Set(
                                    row.groups
                                        .filter(group => group.kind === "GROUP" && group.groupKey)
                                        .map(group => group.groupKey!),
                                ),
                            ]),
                    );
                    const reservedGroupKeys = new Set([...partners.values()].flatMap(keys => [...keys]));
                    const projection = projectStructure(
                        base,
                        normalizeOperations(dto.operations),
                        () => this.snowflake.next(),
                        reservedGroupKeys,
                    );
                    validateCatalogTree(projection.afterTree);
                    assertGroupKeysExclusive(
                        new Set(
                            projection.afterTree
                                .filter(node => node.kind === "GROUP" && node.groupKey)
                                .map(node => node.groupKey!),
                        ),
                        partners,
                    );
                    // 冻结边界引用守卫：被既有 BOM 明细引用的物料不得删除/改名/换组，
                    // 被引用分组（bom_item.group_key 冻结值）不得改名——只能隐藏
                    await this.assertReferencesUntouched(tx, projection, [category.id, ...partnerIds], base);
                    await this.writeProjection(tx, projection, category.id, now);
                    const nextVersion = category.rowVersion + 1n;
                    await tx.bomCategory.update({
                        where: { id: category.id },
                        data: { rowVersion: nextVersion },
                    });
                    const hiddenUsage = await this.countHiddenUsage(tx, projection);
                    await recordOpLog(tx, this.snowflake, actor, {
                        action: "update_bom_structure",
                        targetType: "bom_category",
                        targetId: category.id,
                        targetCode: category.categoryKey,
                        detail: {
                            name: category.name,
                            rowVersionBefore: Number(category.rowVersion),
                            rowVersionAfter: Number(nextVersion),
                            operations: projection.summary,
                            ...(hiddenUsage > 0 ? { hiddenUsage } : {}),
                        },
                        now,
                    });
                    return {
                        httpStatus: 200 as const,
                        responseBody: {
                            rowVersion: Number(nextVersion),
                            ...(hiddenUsage > 0 ? { hiddenUsageCount: hiddenUsage } : {}),
                        },
                        resource: { type: "bom_category", code: category.categoryKey },
                    };
                } catch (error) {
                    throw asUniqueConflict(error);
                }
            },
        );
    }

    async createCategory(
        dto: {
            name: string;
            codePrefix: string;
            seqWidth?: number;
            types?: CategoryTypeDto[];
            groups: DraftNodeDto[];
        },
        actor: AuthUser,
        idempotencyKey: string | undefined,
    ): Promise<BomStructureCategoryCreated> {
        return this.idempotency.runGuarded(
            {
                actorId: BigInt(actor.id),
                operationKey: CREATE_CATEGORY_OPERATION_KEY,
                idempotencyKey,
                digest: { method: "POST", body: dto }, // /bom-structure/categories
            },
            async (tx: Tx) => {
                try {
                    const now = new Date();
                    // 锁全部既有品类行（id 升序）串行化创建：名称/前缀/前缀延长关系都在
                    // 锁内复查；并发插入的唯一窗口由 uk + P2002→409 兜底
                    await tx.$queryRaw`SELECT id FROM bom_category ORDER BY id FOR UPDATE`;
                    const all = await tx.bomCategory.findMany({
                        select: { categoryKey: true, name: true, codePrefix: true },
                    });
                    const types = dto.types ?? [];
                    // 名称唯一：主品类与各类型互不相重、不与既有品类重名（类型与主品类
                    // 平铺在同一 name 命名空间——bom_category.name 全局唯一）
                    const newNames = [dto.name, ...types.map(type => type.name)];
                    for (const [index, name] of newNames.entries()) {
                        const dupInBatch = newNames.indexOf(name) !== index;
                        if (all.some(row => row.name === name) || dupInBatch) {
                            throw new ConflictException(`品类名「${name}」已存在`);
                        }
                    }
                    // 前缀唯一 + 数字延长安全：新前缀集合内部与既有前缀双向校验
                    const newPrefixes = [dto.codePrefix, ...types.map(type => type.codePrefix)];
                    const existingPrefixes = all.map(row => row.codePrefix);
                    for (const [index, prefix] of newPrefixes.entries()) {
                        if (existingPrefixes.includes(prefix) || newPrefixes.indexOf(prefix) !== index) {
                            throw new ConflictException(`编码前缀「${prefix}」已存在`);
                        }
                        assertPrefixSafe(prefix, [...existingPrefixes, ...newPrefixes]);
                    }
                    // categoryKey 依次派生（前缀间可能同基名，taken 集滚动累积）
                    const takenKeys = new Set(all.map(row => row.categoryKey));
                    const categoryKey = this.deriveCategoryKey(dto.codePrefix, [...takenKeys]);
                    takenKeys.add(categoryKey);
                    const childKeys = types.map(type => {
                        const key = this.deriveCategoryKey(type.codePrefix, [...takenKeys]);
                        takenKeys.add(key);
                        return key;
                    });
                    const tree = draftTreeOf(dto.groups, () => this.snowflake.next());
                    validateCatalogTree(tree);
                    const categoryId = this.snowflake.next();
                    const seqWidth = dto.seqWidth ?? 3;
                    await tx.bomCategory.create({
                        data: {
                            id: categoryId,
                            categoryKey,
                            name: dto.name,
                            codePrefix: dto.codePrefix,
                            seqWidth,
                            status: true,
                            rowVersion: 1n,
                            // 下属类型一经创建即登记复合关系（建档时必选其一）
                            ...(childKeys.length > 0 ? { childCategories: childKeys } : {}),
                            createdAt: now,
                            updatedAt: now,
                        },
                    });
                    // 下属类型 = 目录容器品类（status=false，永不取号、不进建档下拉），
                    // 与既有 焊线/插线、新/老微动跌倒 容器同构
                    const createdTypes: Array<{ id: bigint; key: string; name: string; codePrefix: string }> = [];
                    for (const [index, type] of types.entries()) {
                        const typeId = this.snowflake.next();
                        await tx.bomCategory.create({
                            data: {
                                id: typeId,
                                categoryKey: childKeys[index]!,
                                name: type.name,
                                codePrefix: type.codePrefix,
                                seqWidth: 3,
                                status: false,
                                rowVersion: 1n,
                                createdAt: now,
                                updatedAt: now,
                            },
                        });
                        createdTypes.push({
                            id: typeId,
                            key: childKeys[index]!,
                            name: type.name,
                            codePrefix: type.codePrefix,
                        });
                    }
                    if (tree.length > 0) {
                        await tx.materialGroup.createMany({
                            data: tree.map(node => ({
                                id: BigInt(node.id),
                                categoryId,
                                parentId: node.parentId === null ? null : BigInt(node.parentId),
                                kind: node.kind,
                                name: node.name,
                                groupKey: node.groupKey,
                                multi: node.multi,
                                qty: node.qty,
                                sortOrder: node.sortOrder,
                                createdAt: now,
                            })),
                        });
                        const items = tree.flatMap(node =>
                            node.items.map(item => ({
                                id: BigInt(item.id),
                                groupId: BigInt(node.id),
                                name: item.name,
                                sortOrder: item.sortOrder,
                                createdAt: now,
                            })),
                        );
                        if (items.length > 0) {
                            await tx.materialItem.createMany({ data: items });
                        }
                    }
                    const sections = tree.filter(node => node.kind === "SECTION").length;
                    const groups = tree.length - sections;
                    const itemCount = tree.reduce((sum, node) => sum + node.items.length, 0);
                    await recordOpLog(tx, this.snowflake, actor, {
                        action: "create_bom_category",
                        targetType: "bom_category",
                        targetId: categoryId,
                        targetCode: categoryKey,
                        detail: {
                            name: dto.name,
                            categoryKey,
                            codePrefix: dto.codePrefix,
                            seqWidth,
                            sections,
                            groups,
                            items: itemCount,
                            ...(createdTypes.length > 0
                                ? {
                                      types: createdTypes.map(type => ({
                                          name: type.name,
                                          categoryKey: type.key,
                                          codePrefix: type.codePrefix,
                                      })),
                                  }
                                : {}),
                        },
                        now,
                    });
                    return {
                        httpStatus: 200 as const,
                        responseBody: {
                            key: categoryKey,
                            name: dto.name,
                            codePrefix: dto.codePrefix,
                            rowVersion: 1,
                            ...(createdTypes.length > 0
                                ? {
                                      types: createdTypes.map(type => ({
                                          key: type.key,
                                          name: type.name,
                                          codePrefix: type.codePrefix,
                                          rowVersion: 1,
                                      })),
                                  }
                                : {}),
                        },
                        resource: { type: "bom_category", code: categoryKey },
                    };
                } catch (error) {
                    throw asUniqueConflict(error);
                }
            },
        );
    }

    /** 伙伴品类 id 集：正向（本品类 child_categories 引用的子品类）+ 反向（child_categories
     *  引用了本品类 key 的主品类）。品类表仅 9 行量级，全量内存判定即可 */
    private async partnerCategoryIds(tx: Tx, categoryId: bigint): Promise<bigint[]> {
        const all = await tx.bomCategory.findMany({
            select: { id: true, categoryKey: true, childCategories: true },
        });
        const self = all.find(row => row.id === categoryId);
        if (!self) {
            return [];
        }
        const selfKey = self.categoryKey;
        const partnerKeys = new Set(childKeysOf(self.childCategories));
        for (const row of all) {
            if (childKeysOf(row.childCategories).includes(selfKey)) {
                partnerKeys.add(row.categoryKey);
            }
        }
        partnerKeys.delete(selfKey);
        return all.filter(row => partnerKeys.has(row.categoryKey)).map(row => row.id);
    }

    private async writeProjection(tx: Tx, projection: ProjectionResult, categoryId: bigint, now: Date): Promise<void> {
        const writes = projection.writes;
        // 1) 物料删行先行：让出 (group_id, name) 唯一键并释放对 doomed 分组的引用
        if (writes.deleteItems.length > 0) {
            await tx.materialItem.deleteMany({ where: { id: { in: writes.deleteItems } } });
        }
        // 2) 改挂先行（分组 parentId / 物料 groupId）：fk ON DELETE RESTRICT 要求先把
        //    子行摘离即将删除的父行——「移出后删组/删分区」必须先落改挂
        for (const update of writes.updateGroups) {
            if (update.data.parentId === undefined) {
                continue;
            }
            await tx.materialGroup.update({
                where: { id: update.id },
                data: {
                    parentId: update.data.parentId,
                    ...(update.data.sortOrder !== undefined ? { sortOrder: update.data.sortOrder } : {}),
                    updatedAt: now,
                },
            });
        }
        for (const update of writes.updateItems) {
            if (update.data.groupId === undefined) {
                continue;
            }
            await tx.materialItem.update({
                where: { id: update.id },
                data: {
                    groupId: update.data.groupId,
                    ...(update.data.sortOrder !== undefined ? { sortOrder: update.data.sortOrder } : {}),
                    updatedAt: now,
                },
            });
        }
        // 3) 节点删行：分组（子）先于分区（父）——同一语句内父行先删必撞 RESTRICT
        const doomedGroups = writes.deleteGroups.filter(row => row.kind === "GROUP").map(row => row.id);
        const doomedSections = writes.deleteGroups.filter(row => row.kind === "SECTION").map(row => row.id);
        if (doomedGroups.length > 0) {
            await tx.materialGroup.deleteMany({ where: { id: { in: doomedGroups } } });
        }
        if (doomedSections.length > 0) {
            await tx.materialGroup.deleteMany({ where: { id: { in: doomedSections } } });
        }
        // 4) 改名两阶段：先挪到行内唯一临时名（tmp-<id>，雪花 id 保证互异），再在阶段 6
        //    落最终名——同批换名/环链（A→B、B→A）在逐行更新下不会中间态撞唯一键
        const groupRenames = writes.updateGroups.filter(update => update.data.name !== undefined);
        const itemRenames = writes.updateItems.filter(update => update.data.name !== undefined);
        for (const update of groupRenames) {
            await tx.materialGroup.update({
                where: { id: update.id },
                data: { name: `tmp-${update.id.toString()}`, updatedAt: now },
            });
        }
        for (const update of itemRenames) {
            await tx.materialItem.update({
                where: { id: update.id },
                data: { name: `tmp-${update.id.toString()}`, updatedAt: now },
            });
        }
        // 5) 新增（Map 序保证分区先于其下新分组，自引用外键逐行检查可通过）
        if (writes.createGroups.length > 0) {
            await tx.materialGroup.createMany({
                data: writes.createGroups.map(group => ({ ...group, categoryId, createdAt: now })),
            });
        }
        if (writes.createItems.length > 0) {
            await tx.materialItem.createMany({
                data: writes.createItems.map(item => ({ ...item, createdAt: now })),
            });
        }
        // 6) 其余更新（状态/规则/最终名/顺序；改挂字段已在阶段 2 落库，跳过）
        for (const update of writes.updateGroups) {
            const { parentId, ...rest } = update.data;
            void parentId;
            if (Object.keys(rest).length === 0) {
                continue;
            }
            await tx.materialGroup.update({ where: { id: update.id }, data: { ...rest, updatedAt: now } });
        }
        for (const update of writes.updateItems) {
            const { groupId, ...rest } = update.data;
            void groupId;
            if (Object.keys(rest).length === 0) {
                continue;
            }
            await tx.materialItem.update({ where: { id: update.id }, data: { ...rest, updatedAt: now } });
        }
    }

    /**
     * 冻结边界引用守卫（db-scheme.md §5.4）：基线物料被 bom_item 引用（material_id）
     * 时禁止删除/改名/换组；基线分组被引用（group_key 冻结值，限本品类及其伙伴品类的
     * BOM）时禁止改名。分区名不进冻结快照，改名不受限。命中即 400，指引改走「隐藏」。
     */
    private async assertReferencesUntouched(
        tx: Tx,
        projection: ProjectionResult,
        categoryIds: bigint[],
        base: CatalogTreeNode[],
    ): Promise<void> {
        const itemNames = new Map(base.flatMap(node => node.items.map(item => [item.id, item.name] as const)));
        const nameOf = (id: bigint): string => itemNames.get(id.toString()) ?? `物料 ${id.toString()}`;
        const guardItems = async (ids: bigint[], remedy: string): Promise<void> => {
            if (ids.length === 0) {
                return;
            }
            const rows = await tx.$queryRaw<
                Array<{ materialId: bigint; cnt: bigint | number }>
            >`SELECT material_id AS materialId, COUNT(*) AS cnt FROM bom_item
              WHERE material_id IN (${Prisma.join(ids)}) GROUP BY material_id LIMIT 1`;
            const hit = rows[0];
            if (hit) {
                throw new BadRequestException(
                    `物料「${nameOf(hit.materialId)}」已被 ${Number(hit.cnt)} 行既有 BOM 明细引用，${remedy}`,
                );
            }
        };
        await guardItems(projection.removedItemIds, "不能删除；请改为设为不可选（旧档案不受影响）");
        await guardItems(projection.renamedItemIds, "不能改名；请新增替代物料并把旧物料设为不可选");
        await guardItems(projection.movedItemIds, "不能移动到其他分组；请新增替代物料并把旧物料设为不可选");
        for (const group of projection.renamedGroupKeys) {
            const usage = await tx.bomItem.count({
                where: { groupKey: group.groupKey, bom: { categoryId: { in: categoryIds } } },
            });
            if (usage > 0) {
                throw new BadRequestException(
                    `分组「${group.name}」已被 ${usage} 行既有 BOM 明细引用，不能改名；请新建分组并新增物料`,
                );
            }
        }
    }

    /** 本次隐藏物料被既有 BOM 明细引用的行数（提示不阻断；idx_bom_item_material） */
    private async countHiddenUsage(tx: Tx, projection: ProjectionResult): Promise<number> {
        if (projection.hiddenMaterialIds.length === 0) {
            return 0;
        }
        const [row] = await tx.$queryRaw<Array<{ cnt: bigint | number }>>`
            SELECT COUNT(*) AS cnt FROM bom_item WHERE material_id IN (${Prisma.join(projection.hiddenMaterialIds)})`;
        return Number(row!.cnt);
    }

    /** categoryKey 由前缀派生（小写 + 非字母数字转 -），冲突时追加 -2/-3… */
    private deriveCategoryKey(codePrefix: string, existingKeys: string[]): string {
        const base = codePrefix
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        const taken = new Set(existingKeys);
        let key = base || "cat";
        let suffix = 2;
        while (taken.has(key)) {
            key = `${base}-${suffix}`;
            suffix += 1;
        }
        return key;
    }
}
