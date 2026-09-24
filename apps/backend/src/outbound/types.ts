/** 契约 OutboundRow（openapi outbound tag）：customer 为下单时快照 */
export interface OutboundRow {
    no: string;
    orderNo: string;
    customer: string;
    customerCode: string;
    bomCode: string;
    qty: number;
    date: string;
    time: string;
    operator: string;
    remark: string;
    state: "registered" | "voided";
    version: number;
    voidReason?: string;
}

/** 契约 OutboundPrintDocument（GET /outbound/{no}/print 响应）：实时组装的纸质单快照，
 * 打印无副作用不落日志；state/voidReason 供打印件渲染作废标注；
 * registeredAt 为实际登记时刻（区别于手选补录的出库日期 date） */
export interface OutboundPrintDocument {
    no: string;
    orderNo: string;
    customer: string;
    customerCode: string;
    bomCode: string;
    bomSpec: string;
    qty: number;
    date: string;
    registeredAt: string;
    operator: string;
    remark: string;
    state: "registered" | "voided";
    voidReason?: string;
    printedBy: string;
    printedAt: string;
}
