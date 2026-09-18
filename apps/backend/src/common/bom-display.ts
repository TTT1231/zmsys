/**
 * BOM 物料目录契约与快照摘要（db-scheme.md §5）：BOM = 品类 + 选中物料集合，
 * 建档时冻结 groupKey/groupName/name/position 到 bom_item；展示与摘要
 * （“组名：物料名”按冻结 position 排序）不依赖当前目录——目录后续改名、
 * 排序调整或停用都不影响已建 BOM 与订单/出库打印快照。
 */

/** 契约 BomCatalogNode（openapi boms tag）：分区为纯展示树节点，分组挂可选物料 */
export interface BomCatalogNode {
    id: string;
    parentId: string | null;
    kind: 'section' | 'group';
    name: string;
    /** 分组稳定标识（如 model）；分区为 null */
    key: string | null;
    /** 分组选择语义：false 单选（0/1 项，换选替换）/ true 多选；分区为 null */
    multi: boolean | null;
    /** 分区恒为空数组 */
    items: Array<{ id: string; name: string }>;
}

/** 契约 BomItemView：GET /boms 的明细行（按建档 position 排序返回） */
export interface BomItemView {
    materialId: string;
    groupKey: string;
    groupName: string;
    name: string;
}

/** bom_item 行的快照字段（Prisma 行或其投影，materialId 序列化为 string） */
export interface BomItemSnapshotInput {
    materialId: bigint | string;
    groupKey: string;
    groupName: string;
    name: string;
    position: number;
}

/** 订单 bom_spec_snapshot 的冻结形态（JSON 对象，满足列 CHECK） */
export interface BomItemsSnapshot {
    items: Array<BomItemSnapshotInput & { materialId: string }>;
    modelCode: string;
    spec: string;
}

/** 规格摘要项：“组名：物料名”（全角冒号，与前端展示一致） */
const summaryPartOf = (item: { groupName: string; name: string }): string => `${item.groupName}：${item.name}`;

/** 由冻结明细构建快照：position 升序；modelCode 取 groupKey=model 的选中项 */
export function bomItemsSnapshotOf(items: readonly BomItemSnapshotInput[]): BomItemsSnapshot {
    const sorted = [...items]
        .sort((a, b) => a.position - b.position)
        .map(item => ({ ...item, materialId: item.materialId.toString() }));
    const model = sorted.find(item => item.groupKey === 'model');
    return {
        items: sorted,
        modelCode: model?.name ?? '',
        spec: sorted.map(summaryPartOf).join(' · '),
    };
}

/** 规格摘要视图（不含 position，GET /boms 明细行） */
export function bomItemViewsOf(items: readonly BomItemSnapshotInput[]): BomItemView[] {
    return bomItemsSnapshotOf(items).items.map(({ materialId, groupKey, groupName, name }) => ({
        materialId,
        groupKey,
        groupName,
        name,
    }));
}

/**
 * 打印文档 bomSpec（契约 outbound:print）：直接取订单冻结快照的 spec 字符串；
 * 存量/异常快照缺失 spec 时按冻结 items 以同一规则拼装，绝不读当前目录。
 */
export function bomSpecOf(snapshot: unknown): string {
    const shape = snapshot as { spec?: unknown; items?: unknown } | null;
    if (typeof shape?.spec === 'string' && shape.spec.trim()) {
        return shape.spec;
    }
    const items = Array.isArray(shape?.items) ? (shape!.items as Array<{ groupName?: unknown; name?: unknown }>) : [];
    return items
        .filter(item => typeof item?.groupName === 'string' && typeof item?.name === 'string')
        .map(item => summaryPartOf(item as { groupName: string; name: string }))
        .join(' · ');
}
