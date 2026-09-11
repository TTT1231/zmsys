/* API 契约类型中心：与 docs/api/openapi.yaml、mocks/request 三方对齐 */
import type { RoleGrant, RoleId } from "@/data/permissions";

/* ---------- 业务实体（对应 db-scheme.md 各表，业务码为唯一 API key） ---------- */

export type StatusKey = "done" | "progress" | "ready" | "pending" | "cancelled";
export type OrderLifecycleStatus = "active" | "cancelled";

export interface OrderStatus {
    label: string;
    key: StatusKey;
}

export interface Order {
    version: number;
    orderNo: string;
    customer: string;
    customerCode: string;
    bomCode: string;
    qty: number;
    outbound: number;
    orderDate: string;
    deliverStart: string; // 交货起始日期
    deliverEnd: string; // 交货截止日期（排序/逾期口径）
    remark: string;
    lifecycleStatus: OrderLifecycleStatus;
    cancelledAt?: string;
    cancelledBy?: string;
    cancelReason?: string;
}

export interface BomSpecField {
    key: string;
    label: string;
    type: "select" | "text";
    options?: string[];
    required?: boolean;
    placeholder?: string;
    initial?: string;
    defaultValue?: string;
}

/** 后端权威 BOM 品类目录 */
export interface BomCategory {
    key: string;
    name: string;
    codePrefix: string;
    seqWidth?: number;
    fields: BomSpecField[];
}

export interface Bom {
    code: string; // 编码，如 ZMXK2001 / ZMXK3001 / ZMKW0001 / ZMKW16001 / ZMKQ001
    name: string; // 品类：旋转开关 / XK3 / 新微动 / 老微动 / 琴键开关
    modelCode: string; // 型号
    specs: Record<string, string>; // 品类规格键值对（对应库表 spec JSON）
    spec: string; // 规格摘要（列表/搜索用）
    created: string;
    unit: string;
}

export interface Customer {
    version: number;
    code: string;
    name: string;
    contact: string;
    /** 脱敏号（如 138****6821）；完整号仅入库存储，API 不返回 */
    phone: string;
    /** 行政区划四级（省/市/县区/乡镇），district/town 可空（直筒子市等） */
    province: string;
    city: string;
    district: string;
    town: string;
    address: string;
    /** 合作状态（聚合派生：近 6 个月有订单 = 合作中，否则待跟进） */
    cooperation: "合作中" | "待跟进";
    owner: string;
    ownerAccount: string;
    payTerms: string;
    created: string;
}

export interface InboundRow {
    no: string;
    bomCode: string;
    qty: number;
    date: string;
    time: string;
    inspector: string;
    remark?: string;
    status: "active" | "voided";
    version: number;
    createdAt: string;
    updatedBy?: string;
    updatedAt?: string;
}

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
    remark?: string;
    state: "registered" | "printed" | "voided";
    version: number;
    printVersion: number;
    voidReason?: string;
}

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

export interface OutboundPrintResult {
    outbound: OutboundRow;
    printVersion: number;
    document: OutboundPrintDocument;
}

/** 后端已落打印日志并计算哈希的纸质单快照；前端只能据此渲染，不再自行拼接当前主数据。 */
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

export interface WbUser {
    version: number;
    name: string;
    account: string;
    role: RoleId;
    active: boolean;
    last: string;
}

/** 客户编辑页的最小负责人候选；接口只返回启用中的销售，不暴露登录时间等用户管理信息。 */
export interface CustomerOwnerOption {
    name: string;
    account: string;
}

export interface OpLogEntry {
    date: string;
    time: string;
    user: string;
    role: string;
    action: string;
    target: string;
}

/** 聚合快照：由各资源端点在前端聚合（库存由出入库台账推导） */
export interface Snapshot {
    version: number;
    orders: Order[];
    boms: Bom[];
    bomCategories: BomCategory[];
    customers: Customer[];
    inboundLedger: InboundRow[];
    outboundLedger: OutboundRow[];
    stockAdjustments: StockAdjustmentRow[];
    stock: Record<string, number>;
    users: WbUser[];
    customerOwnerOptions: CustomerOwnerOption[];
}

/* ---------- 认证与授权 ---------- */

export interface LoginInput {
    account: string;
    password: string;
}

export interface ChangePasswordInput {
    oldPassword: string;
    newPassword: string;
}

export interface LoginResult {
    accessToken: string;
    user: WbUser;
}

/** 登录用户 + 其角色的授权（对应 sys_grant 按 role 下发） */
export interface ProfileResult {
    user: WbUser;
    grant: RoleGrant;
}

export interface RoleDef {
    id: RoleId;
    name: string;
    locked?: boolean;
}

/** 授权变更日志条目 */
export interface GrantLogEntry {
    time: string;
    user: string;
    text: string;
}

/* ---------- 写操作入参（服务端生成编码/单号并做业务校验） ---------- */

export interface CreateOrderInput {
    customerCode: string;
    bomCode: string;
    qty: number;
    deliverStart: string;
    deliverEnd: string;
    orderDate: string;
    remark: string;
}

export interface UpdateOrderInput {
    expectedVersion: number;
    qty?: number;
    deliverStart?: string;
    deliverEnd?: string;
    remark?: string;
}

export interface CancelOrderInput {
    expectedVersion: number;
    reason: string;
}

export interface CreateCustomerInput {
    name: string;
    contact: string;
    phone: string;
    /** 行政区划四级，district/town 可空 */
    province: string;
    city: string;
    district: string;
    town: string;
    address: string;
    /** 所属销售（sys_user 账号，role=sales） */
    ownerAccount: string;
    /** 付款条件（可空，默认空串） */
    payTerms: string;
}

export interface UpdateCustomerInput {
    expectedVersion: number;
    name: string;
    contact: string;
    phone: string;
    province: string;
    city: string;
    district: string;
    town: string;
    address: string;
    ownerAccount: string;
    payTerms: string;
}

export interface CreateBomInput {
    name: string;
    modelCode: string;
    specs: Record<string, string>;
}

export interface CreateInboundInput {
    bomCode: string;
    qty: number;
    date: string;
    remark: string;
}

export interface UpdateInboundInput {
    expectedVersion: number;
    bomCode: string;
    qty: number;
    date: string;
    remark: string;
    reason: string;
}

export interface VoidInboundInput {
    expectedVersion: number;
    reason: string;
}

export interface CreateStockAdjustmentInput {
    bomCode: string;
    qtyDelta: number;
    date: string;
    reason: string;
    relatedInboundNo?: string;
}

export interface CreateOutboundInput {
    orderNo: string;
    qty: number;
    date: string;
    remark: string;
}

export interface VoidOutboundInput {
    expectedVersion: number;
    reason: string;
}

export interface PrintOutboundInput {
    expectedVersion: number;
    reason?: string;
}

export interface EmergencyVoidOutboundInput {
    expectedVersion: number;
    reason: string;
    goodsNotDeparted: true;
    paperInvalidated: true;
}

export interface CreateUserInput {
    name: string;
    account: string;
    role: Exclude<RoleId, "super">;
}

export interface UpdateUserInput {
    expectedVersion: number;
    name: string;
    role: RoleId;
    replacementOwnerAccount?: string;
    transferReason?: string;
}

export interface SetUserStatusInput {
    expectedVersion: number;
    active: boolean;
    replacementOwnerAccount?: string;
    transferReason?: string;
}

/* ---------- 前端派生视图行（服务端不出统计端点，前端基于快照计算） ---------- */

export interface ReadyToShipRow {
    orderNo: string;
    customer: string;
    customerCode: string;
    bomCode: string;
    bomLabel: string;
    deliverStart: string;
    deliverEnd: string;
    remaining: number;
    stock: number;
    maxShip: number;
    status: OrderStatus;
    overdue: boolean;
}

export interface StockGapRow {
    bomCode: string;
    gapQty: number;
    demandQty: number;
    stockQty: number;
    orderCount: number;
    earliestDate: string;
    earliestOrderNo: string;
    earliestCustomer: string;
    earliestOverdue: boolean;
}

export interface TrendRow {
    date: string;
    label: string;
    orderedQty: number;
    orderedCount: number;
    inboundQty: number;
    inboundCount: number;
    outboundQty: number;
    outboundCount: number;
}
