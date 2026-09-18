/** 契约 OutboundRow（openapi outbound tag）：customer 为下单时快照；printVersion 0 表示未打印 */
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
    state: "registered" | "printed" | "voided";
    version: number;
    printVersion: number;
    voidReason?: string;
}

/** 契约 OutboundPrintDocument：后端落日志并计算哈希的纸质单快照，前端只渲染 */
export interface OutboundPrintDocument {
    no: string;
    printVersion: number;
    orderNo: string;
    customer: string;
    customerCode: string;
    bomCode: string;
    bomSpec: string;
    qty: number;
    date: string;
    operator: string;
    remark: string;
    printedBy: string;
    printedAt: string;
}

/** 契约 OutboundPrintResult（POST /outbound/{no}/print 响应体） */
export interface OutboundPrintResult {
    outbound: OutboundRow;
    printVersion: number;
    document: OutboundPrintDocument;
}
