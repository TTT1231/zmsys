/** 契约 BomSpecField（openapi boms tag）：品类规格字段元数据，目录由后端权威下发 */
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

/** 契约 BomCategory：key 为稳定标识，seqWidth 缺省 3 */
export interface BomCategory {
    key: string;
    name: string;
    codePrefix: string;
    seqWidth?: number;
    fields: BomSpecField[];
}

/** 契约 Bom：spec 为规格摘要行；created 为北京日 yyyy-MM-dd */
export interface Bom {
    code: string;
    name: string;
    modelCode: string;
    specs: Record<string, string>;
    spec: string;
    created: string;
    unit: string;
}
