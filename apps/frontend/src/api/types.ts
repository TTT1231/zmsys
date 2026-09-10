/* API 契约类型中心：与 docs/api/openapi.yaml、src/mocks/handlers 三方对齐 */
import type { RoleGrant, RoleId } from "@/data/permissions";

/* ---------- 业务实体（对应 db-scheme.md 各表，业务码为唯一 API key） ---------- */

export type StatusKey = "done" | "progress" | "ready" | "pending";

export interface OrderStatus {
    label: string;
    key: StatusKey;
}

export interface Order {
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
}

export interface WbUser {
    id: number;
    name: string;
    account: string;
    role: RoleId;
    active: boolean;
    last: string;
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
    customers: Customer[];
    inboundLedger: InboundRow[];
    outboundLedger: OutboundRow[];
    stock: Record<string, number>;
    users: WbUser[];
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
    customer: string;
    bomCode: string;
    qty: number;
    deliverStart: string;
    deliverEnd: string;
    orderDate: string;
    remark: string;
}

export interface UpdateOrderInput {
    qty?: number;
    deliverStart?: string;
    deliverEnd?: string;
    remark?: string;
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

export interface CreateOutboundInput {
    orderNo: string;
    qty: number;
    date: string;
    remark: string;
}

export interface CreateUserInput {
    name: string;
    account: string;
    role: RoleId;
}

export interface UpdateUserInput {
    name: string;
    role: RoleId;
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
