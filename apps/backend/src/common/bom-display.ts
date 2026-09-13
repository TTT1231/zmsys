/**
 * BOM 品类目录解析与规格摘要（db-scheme.md §5）：纯展示层工具，供 BOM 列表
 * 映射与出库打印文档共用（订单/出库快照的规格摘要必须与 BOM 档案同构）。
 * 目录（bom_category.spec_schema）是字段序与固定规格的唯一权威。
 */

/** 契约 BomSpecField（openapi boms tag）：品类规格字段元数据 */
export interface BomSpecField {
    key: string;
    label: string;
    type: 'select' | 'text';
    options?: string[];
    required?: boolean;
    placeholder?: string;
    initial?: string;
    defaultValue?: string;
}

/** bom_category.spec_schema 的存储形态：{ fields: [...] } */
interface SpecSchemaShape {
    fields?: unknown;
}

/** 解析品类字段元数据；目录由迁移播种，结构异常视为服务端错误及早暴露 */
export function parseCategoryFields(specSchema: unknown): BomSpecField[] {
    const fields = (specSchema as SpecSchemaShape | null)?.fields;
    if (!Array.isArray(fields) || fields.some(field => typeof field?.key !== 'string')) {
        throw new Error('品类规格元数据结构异常');
    }
    return fields as BomSpecField[];
}

/** 品类常量属性（defaultValue 字段）：建档时强制并入档，客户端同名值不能覆盖 */
export const fixedSpecsOf = (fields: BomSpecField[]): Record<string, string> =>
    Object.fromEntries(
        fields.filter(field => field.defaultValue !== undefined).map(field => [field.key, field.defaultValue!]),
    );

/**
 * 规格摘要（契约 Bom.spec / 出库打印 bomSpec）：型号在前，非空且非品类常量的
 * 规格项 “键 值” 以 “ · ” 连接；品类常量（defaultValue）各条目一致、无区分度，
 * 不进摘要。按目录字段顺序生成（spec JSON 列经 MySQL 键序重排，插入序不可依赖）；
 * 目录外的存量键防御性附加在尾部，不丢信息。
 */
export function specSummaryOf(modelCode: string, specs: Record<string, string>, fields: BomSpecField[]): string {
    const visible = (value: string | undefined, defaultValue?: string): value is string =>
        !!value && !!value.trim() && value !== defaultValue;
    const inOrder = fields
        .filter(field => visible(specs[field.key], field.defaultValue))
        .map(field => `${field.key} ${specs[field.key]}`);
    const knownKeys = new Set(fields.map(field => field.key));
    const extras = Object.keys(specs)
        .filter(key => !knownKeys.has(key) && visible(specs[key]))
        .map(key => `${key} ${specs[key]}`);
    return [modelCode, ...inOrder, ...extras].filter(Boolean).join(' · ');
}
