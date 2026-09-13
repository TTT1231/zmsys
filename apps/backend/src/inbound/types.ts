/** 契约 InboundRow（openapi inbound tag）：inspector 为登记人姓名快照；time 为北京展示戳 */
export interface InboundRow {
    no: string;
    bomCode: string;
    qty: number;
    date: string;
    time: string;
    inspector: string;
    remark: string;
    status: 'active' | 'voided';
    version: number;
    createdAt: string;
    updatedBy?: string;
    updatedAt?: string;
}

/** 契约 StockAdjustmentRow（openapi inbound tag）：qtyDelta 为非零有符号差额 */
export interface StockAdjustmentRow {
    no: string;
    bomCode: string;
    qtyDelta: number;
    date: string;
    time: string;
    operator: string;
    reason: string;
    relatedInboundNo?: string;
}
