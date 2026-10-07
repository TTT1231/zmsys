/**
 * BOM 物料目录契约与快照摘要（db-scheme.md §5）：BOM = 品类 + 选中物料集合，
 * 建档时冻结 groupKey/groupName/name/position/quantity 到 bom_item；展示与
 * 摘要（“组名：物料名 ×N”按冻结 position 排序，数量 1 省略 ×N）不依赖当前
 * 目录——目录后续改名、排序调整或停用都不影响已建 BOM 与订单冻结快照。
 */

/** 契约 BomCatalogNode（openapi boms tag）：分区为纯展示树节点，分组挂可选物料 */
export interface BomCatalogNode {
    id: string;
    parentId: string | null;
    kind: "section" | "group";
    name: string;
    /** 分组稳定标识（如 model）；分区为 null */
    key: string | null;
    /** 分组选择语义：false 单选（0/1 项，换选替换）/ true 多选；分区为 null */
    multi: boolean | null;
    /** 分组数量语义：true 时选中项可携带 1-99 数量（如扣板/静片）；分区为 null */
    qty: boolean | null;
    /** 分区恒为空数组 */
    items: Array<{ id: string; name: string }>;
}

/** 契约 BomItemView：GET /boms 的明细行（按建档 position 排序返回） */
export interface BomItemView {
    materialId: string;
    groupKey: string;
    groupName: string;
    name: string;
    /** 冻结数量：qty 分组 1-99，其余恒 1；旧订单快照缺省按 1 */
    quantity: number;
}

/** bom_item 行的快照字段（Prisma 行或其投影，materialId 序列化为 string；
 * quantity 可缺省——20260922000000 之前的订单 bom_spec_snapshot 无此字段） */
export interface BomItemSnapshotInput {
    materialId: bigint | string;
    groupKey: string;
    groupName: string;
    name: string;
    position: number;
    quantity?: number;
}

/** 订单 bom_spec_snapshot 的冻结形态（JSON 对象，满足列 CHECK） */
export interface BomItemsSnapshot {
    items: Array<BomItemSnapshotInput & { materialId: string; quantity: number }>;
    modelCode: string;
    spec: string;
}

/** 规格摘要项：“组名：物料名”（全角冒号，与前端展示一致），数量 >1 追加 “ ×N” */
const summaryPartOf = (item: { groupName: string; name: string; quantity?: number }): string => {
    const quantity = item.quantity ?? 1;
    return `${item.groupName}：${item.name}${quantity > 1 ? ` ×${quantity}` : ""}`;
};

/** 由冻结明细构建快照：position 升序；modelCode 取 groupKey=model 的选中项 */
export function bomItemsSnapshotOf(items: readonly BomItemSnapshotInput[]): BomItemsSnapshot {
    const sorted = [...items]
        .sort((a, b) => a.position - b.position)
        .map(item => ({
            ...item,
            materialId: item.materialId.toString(),
            quantity: item.quantity ?? 1,
        }));
    const model = sorted.find(item => item.groupKey === "model");
    return {
        items: sorted,
        modelCode: model?.name ?? "",
        spec: sorted.map(summaryPartOf).join(" · "),
    };
}

/** 规格摘要视图（不含 position，GET /boms 明细行）；已构建快照时直接复用，避免重复派生 */
export function toBomItemViews(snapshot: BomItemsSnapshot): BomItemView[] {
    return snapshot.items.map(({ materialId, groupKey, groupName, name, quantity }) => ({
        materialId,
        groupKey,
        groupName,
        name,
        quantity,
    }));
}

/** 规格摘要视图（不含 position，GET /boms 明细行） */
export function bomItemViewsOf(items: readonly BomItemSnapshotInput[]): BomItemView[] {
    return toBomItemViews(bomItemsSnapshotOf(items));
}

/**
 * 订单冻结快照的规格摘要（系统日志 change-details 的「规格构成」展示）：
 * 取快照的 spec 字符串；存量快照缺失的 spec 已由迁移 20260947000000 一次性
 * 回填，读侧不再按 items 兜底重拼——异常缺失返回空串（与空值不展示口径一致）。
 */
export function bomSpecOf(snapshot: unknown): string {
    const shape = snapshot as { spec?: unknown } | null;
    return typeof shape?.spec === "string" && shape.spec.trim() ? shape.spec : "";
}
