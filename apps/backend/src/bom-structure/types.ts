/** 契约类型（openapi bom-structure tag） */

/** POST /bom-structure/apply 响应：新版本号；隐藏物料被既有 BOM 引用时附带行数提示 */
export interface BomStructureApplyResult {
    rowVersion: number;
    /** 本次隐藏的物料仍被既有 BOM 明细引用的总行数（提示不阻断——隐藏不影响旧档案） */
    hiddenUsageCount?: number;
}

/** POST /bom-structure/categories 响应 */
export interface BomStructureCategoryCreated {
    key: string;
    name: string;
    codePrefix: string;
    rowVersion: number;
}
