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
