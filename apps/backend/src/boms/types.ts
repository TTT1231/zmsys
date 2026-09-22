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
    /** false = 目录容器品类（如旋转XK3 的焊线/插线变体）：仅随目录接口下发供
     * 合并树使用，不出现在建档品类下拉；缺省（启用品类）不下发该字段 */
    status?: boolean;
    seqWidth?: number;
    childCategories?: string[];
    groups: BomCatalogNode[];
}

/** 契约 Bom：items 按建档 position 排序；modelCode 由 model 组选中项派生（无则 ""）；
 * remark 为建档备注（工艺差异，参与判重指纹），空串 = 无备注 */
export interface Bom {
    code: string;
    name: string;
    modelCode: string;
    items: BomItemView[];
    spec: string;
    remark: string;
    created: string;
    unit: string;
}

/** 契约 StockFlowRow（openapi boms tag）：单笔库存变动；qty 有符号
 * （入库 +、出库 −、调整 ±），balance 为该笔完成后余量，口径同 v_bom_stock */
export interface StockFlowRow {
    type: "in" | "out" | "adjust";
    no: string;
    date: string;
    qty: number;
    balance: number;
    operator: string;
    remark: string;
    /** 仅出库行：订单建档时的客户名称快照；入库/调整行没有客户，字段省略 */
    customer?: string;
}

/** 契约 BomStockLedger：flows 按业务日升序（旧 → 新），stockQty 与 flows 末笔 balance 一致 */
export interface BomStockLedger {
    bomCode: string;
    stockQty: number;
    flows: StockFlowRow[];
}
