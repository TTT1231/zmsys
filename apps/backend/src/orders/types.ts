/** 契约 Order（openapi orders tag）：customer 为下单时名称快照；outbound 为有效出库净额；
 * createdBy/createdAt 为创建人姓名与创建时刻（审计展示，不随编辑变化） */
export interface Order {
    version: number;
    orderNo: string;
    customer: string;
    customerCode: string;
    bomCode: string;
    qty: number;
    outbound: number;
    orderDate: string;
    deliverDate: string;
    remark: string;
    lifecycleStatus: "active" | "archived";
    createdBy: string;
    createdAt: string;
    archivedAt?: string;
    archivedBy?: string;
    /** 归档操作人账号（仅归档终态返回）：前端归档回退入口判等用，账号唯一且不可改 */
    archivedByAccount?: string;
    archiveReason?: string;
}
