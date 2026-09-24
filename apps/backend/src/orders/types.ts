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
    lifecycleStatus: "active" | "cancelled" | "archived";
    createdBy: string;
    createdAt: string;
    cancelledAt?: string;
    cancelledBy?: string;
    cancelReason?: string;
    archivedAt?: string;
    archivedBy?: string;
    archiveReason?: string;
}
