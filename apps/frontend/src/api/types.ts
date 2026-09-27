/* API 契约类型中心：与 docs/openapi.yaml 保持一致 */
import type { RoleGrant, RoleId } from "@/data/permissions";

/* ---------- 业务实体（对应 db-scheme.md 各表，业务码为唯一 API key） ---------- */

export type StatusKey = "done" | "progress" | "ready" | "partReady" | "pending" | "archived";
export type OrderLifecycleStatus = "active" | "archived";

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
    deliverDate: string; // 交货日期（单个日历日，排序/逾期口径）
    remark: string;
    lifecycleStatus: OrderLifecycleStatus;
    createdBy: string; // 创建人姓名（审计展示，不随编辑变化）
    createdAt: string; // 创建时刻 ISO
    archivedAt?: string; // 仅归档终态返回
    archivedBy?: string;
    archiveReason?: string;
}

/** 目录节点：分区（section）为纯展示树节点（不挂物料、不提供全选），分组（group）挂可选物料 */
export interface BomCatalogNode {
    id: string;
    parentId: string | null;
    kind: "section" | "group";
    name: string;
    /** 分组稳定标识（如 model）；分区为 null */
    key: string | null;
    /** 分组选择语义：false 单选（0/1 项，换选替换）/ true 多选；分区为 null */
    multi: boolean | null;
    /** 分组数量语义：true 时选中项可携带 1-99 数量（如扣板/静片）；分区为 null */
    qty: boolean | null;
    /** 分区恒为空数组 */
    items: Array<{ id: string; name: string }>;
}

/** 后端权威 BOM 品类目录（分区/分组扁平树，parentId 关联，数组顺序即展示序）。
 * childCategories 存在时（跌倒开关），建档必须先选一个子品类（childCategory），
 * 该子品类的完整物料目录并入本品类的选择范围（左框树合并展示）。 */
export interface BomCategory {
    key: string;
    name: string;
    codePrefix: string;
    seqWidth?: number;
    childCategories?: string[];
    /** false = 目录容器品类（旋转XK3 的焊线/插线变体）：仅随目录接口下发供合并树，不在建档下拉 */
    status?: boolean;
    groups: BomCatalogNode[];
}

/** BOM 明细行（建档冻结快照，按 position 排序返回；目录后续变更不影响已建档案） */
export interface BomItemView {
    materialId: string;
    groupKey: string;
    groupName: string;
    name: string;
    /** 冻结数量：qty 分组 1-99，其余恒 1 */
    quantity: number;
}

export interface Bom {
    code: string; // 编码（品类前缀 + 序号），如 XK2001 / KW001 / KWO001 / KD001
    name: string; // 品类：旋转XK2 / 旋转XK3 / 新微动 / 老微动 / 安全开关 / 跌倒开关
    modelCode: string; // model 组选中项名称（品类无 model 组时为空串）
    items: BomItemView[]; // 选中物料集合（无数量，跌倒开关含微动物料）
    spec: string; // 摘要（"组名：物料名"以 " · " 连接）
    remark: string; // 建档备注（工艺差异，参与判重指纹）；空串 = 无备注
    creator: string; // 建档人姓名（sys_user.name）
    created: string; // 建档时刻（ISO 8601 带时区）
    unit: string;
}

/** BOM 当前库存余量聚合（GET /bom-stocks）：bomCode → 有效入库 + 库存调整 − 未作废出库 */
export type BomStockMap = Record<string, number>;

/** 单笔库存变动（GET /bom-stocks/{code}/ledger）：qty 有符号（入 +、出 −、调整 ±） */
export interface StockFlowRow {
    type: "in" | "out" | "adjust";
    no: string;
    date: string;
    qty: number;
    /** 该笔完成后余量，口径同 v_bom_stock */
    balance: number;
    operator: string;
    remark: string;
    /** 仅出库行：订单建档时的客户名称快照；入库/调整行没有客户，字段省略 */
    customer?: string;
}

/** BOM 出入库流水：flows 按业务日升序（旧 → 新），stockQty 与末笔 balance 一致 */
export interface BomStockLedger {
    bomCode: string;
    stockQty: number;
    flows: StockFlowRow[];
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
    state: "registered" | "voided";
    version: number;
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

/** 打印文档（GET /outbound/{no}/print 响应）：后端实时组装的纸质单快照，
 * 打印无副作用不落日志；state/voidReason 供打印件渲染作废标注 */
export interface OutboundPrintDocument {
    no: string;
    orderNo: string;
    customer: string;
    customerCode: string;
    bomCode: string;
    bomSpec: string;
    qty: number;
    date: string;
    registeredAt: string; // 实际登记时刻 ISO（区别于手选补录的出库日期）
    operator: string;
    remark: string;
    state: "registered" | "voided";
    voidReason?: string;
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
    /** 创建时间（ISO 8601 带时区） */
    createdAt: string;
    /** 最近一次资料/状态/密码变更时间；从未变更为空 */
    updatedAt?: string;
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
    /** 删除类事件携带删除前快照（对齐真实后端 op_log.detail_json），其余事件为空 */
    detail?: Record<string, boolean | number | string | null>;
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
    stock: BomStockMap;
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
    deliverDate: string;
    orderDate: string;
    remark: string;
}

export interface UpdateOrderInput {
    expectedVersion: number;
    qty?: number;
    deliverDate?: string;
    remark?: string;
}

/** 归档订单仅限超级管理员；备注选填（留空不上送） */
export interface ArchiveOrderInput {
    expectedVersion: number;
    reason?: string;
}

/** 删除订单仅限超级管理员，须净发货为 0 且关联出库单均已删除 */
export interface DeleteOrderInput {
    expectedVersion: number;
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
    materialItemIds: string[];
    /** 数量分组（qty=true）选中项的数量表：物料 id → 1-99 整数；缺省按 1 */
    quantities?: Record<string, number>;
    /** 品类子选（category key）：品类标记 childCategories 时必填（跌倒开关的微动开关类型） */
    childCategory?: string;
    /** 建档备注（trim 后存储）：物料构成之外的工艺差异，参与判重——同构成不同备注 = 不同 BOM */
    remark?: string;
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

export interface DeleteInboundInput {
    expectedVersion: number;
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

export interface DeleteOutboundInput {
    expectedVersion: number;
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

export interface ResetUserPasswordInput {
    expectedVersion: number;
}

/* ---------- 前端派生视图行（服务端不出统计端点，前端基于快照计算） ---------- */

export interface ReadyToShipRow {
    orderNo: string;
    customer: string;
    customerCode: string;
    bomCode: string;
    bomLabel: string;
    deliverDate: string;
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
