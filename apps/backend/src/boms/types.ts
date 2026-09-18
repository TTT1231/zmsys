/** 契约目录节点与明细类型（openapi boms tag）由 common/bom-display 统一定义 */
import type { BomCatalogNode, BomItemView } from "../common/bom-display";

export type { BomCatalogNode, BomItemView };

/** 契约 BomCategory：key 为稳定标识，seqWidth 缺省 3；groups 为分区/分组树。
 * childCategories 存在时（如跌倒开关），建档必须先选一个子品类（childCategory），
 * 该子品类的完整物料目录并入本品类的选择范围。 */
export interface BomCategory {
    key: string;
    name: string;
    codePrefix: string;
    seqWidth?: number;
    childCategories?: string[];
    groups: BomCatalogNode[];
}

/** 契约 Bom：items 按建档 position 排序；modelCode 由 model 组选中项派生（无则 ""） */
export interface Bom {
    code: string;
    name: string;
    modelCode: string;
    items: BomItemView[];
    spec: string;
    created: string;
    unit: string;
}
