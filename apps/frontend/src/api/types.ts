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
    archivedByAccount?: string; // 归档操作人账号：归档回退入口判等用（账号唯一且不可改）
    archiveReason?: string;
}

/** 目录节点：分区（section）为纯展示树节点（不挂物料、不提供全选），分组（group）可同时挂直属物料和子分组。
 * 目录接口全量下发（含停用节点/物料，status=false 标记）——停用项仅供管理页展示与
 * 历史归属匹配（bomComposition），新建 BOM 的可选集按「自身∧祖先启用」过滤；启用省略 status。 */
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
    /** false = 节点已隐藏（不可再选，历史归属仍匹配）；启用省略 */
    status?: boolean;
    /** 分区恒为空数组 */
    items: Array<{ id: string; name: string; /** false = 物料已隐藏；启用省略 */ status?: boolean }>;
}

/** 后端权威 BOM 品类目录（分区/分组扁平树，parentId 关联，数组顺序即展示序）。
 * childCategories 存在时（跌倒开关），建档必须先选一个子品类（childCategory），
 * 该子品类的完整物料目录并入本品类的选择范围（左框树合并展示）。 */
export interface BomCategory {
    key: string;
    name: string;
    codePrefix: string;
    /** 品类目录整树乐观锁版本：结构维护保存携带期望值比对（超管「BOM 结构」页） */
    rowVersion: number;
    seqWidth?: number;
    childCategories?: string[];
    /** false = 目录容器品类（旋转XK3 的焊线/插线变体）：仅随目录接口下发供合并树，不在建档下拉 */
    status?: boolean;
    groups: BomCatalogNode[];
}

/* ---- BOM 结构在线维护（仅超管，openapi bom-structure tag）---- */

/** 结构操作十态（与后端 StructureOperation 同构）；targetId/groupId/parentId
 *  兼容已存节点 id 与同批草稿 tempId，服务端按序投影并校验。rename/move/remove
 *  受冻结边界引用守卫约束：被既有 BOM 明细引用的物料/分组改名/删除会被 400 拒绝 */
export type StructureOperation =
    | { type: "add_section"; tempId: string; name: string }
    | {
          type: "add_group";
          tempId: string;
          name: string;
          parentId: string | null;
          multi: boolean;
          qty: boolean;
          items?: Array<{ tempId: string; name: string }>;
      }
    | { type: "add_item"; tempId: string; groupId: string; name: string }
    | { type: "hide" | "restore"; targetType: "section" | "group" | "item"; targetId: string }
    | { type: "reorder"; targetType: "section" | "group" | "item"; targetId: string; direction: "up" | "down" }
    | { type: "set_rules"; groupId: string; multi: boolean; qty: boolean }
    | { type: "rename"; targetType: "section" | "group" | "item"; targetId: string; name: string }
    | { type: "move"; targetType: "group" | "item"; targetId: string; parentId: string | null }
    | { type: "remove"; targetType: "section" | "group" | "item"; targetId: string };

export interface ApplyBomStructureInput {
    categoryKey: string;
    expectedRowVersion: number;
    operations: StructureOperation[];
}

/** 保存响应：新版本号；隐藏物料被既有 BOM 引用时附带行数提示（不影响旧档案） */
export interface BomStructureApplyResult {
    rowVersion: number;
    hiddenUsageCount?: number;
}

export interface DraftItemInput {
    tempId: string;
    name: string;
}

/** 新建品类草稿节点（平铺，tempId 关联多层父子与组内物料） */
export interface DraftNodeInput {
    kind: "SECTION" | "GROUP";
    tempId: string;
    name: string;
    parentTempId?: string | null;
    multi?: boolean;
    qty?: boolean;
    items?: DraftItemInput[];
}

/** 新建品类时一并创建的下属类型（目录容器品类，status=false） */
export interface CategoryTypeInput {
    name: string;
    codePrefix: string;
}

export interface CreateBomCategoryInput {
    name: string;
    codePrefix: string;
    seqWidth?: number;
    /** 可选下属类型：创建后主品类为复合品类，建档时必选其一 */
    types?: CategoryTypeInput[];
    groups: DraftNodeInput[];
}

export interface BomStructureCategoryCreated {
    key: string;
    name: string;
    codePrefix: string;
    rowVersion: number;
    types?: Array<{ key: string; name: string; codePrefix: string; rowVersion: number }>;
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
    /** 创建人姓名（建档后不变） */
    createdBy: string;
    payTerms: string;
    /** 建档时刻（ISO 8601 带时区），展示用 formatDateTime 到分钟 */
    created: string;
}

export interface InboundRow {
    no: string;
    bomCode: string;
    qty: number;
    unit?: string;
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
    unit?: string;
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

/* ---------- 系统日志（GET /system-logs，仅超级管理员） ---------- */

export type SystemLogDomain = "customer" | "order" | "bom" | "bom_structure" | "inbound" | "outbound";

export type SystemLogAction =
    | "create"
    | "edit"
    | "transfer"
    | "archive"
    | "unarchive"
    | "delete"
    | "void"
    | "ship"
    | "adjust";

/** 单条字段变更（服务端产出中文 label 与展示值；before=null 表示新建记录。
 *  key 为语义源字段名（bomCode/orderNo 等），前端据此渲染可点击编号链接） */
export interface SystemLogChange {
    key?: string;
    label: string;
    before: string | null;
    after: string | null;
}

export interface SystemLogEntry {
    /** 来源行雪花 id（十进制串，游标往返不能 Number 解析） */
    id: string;
    occurredAt: string;
    actor: { name: string; role: string };
    domain: SystemLogDomain;
    action: SystemLogAction;
    targetCode: string;
    targetName: string | null;
    changes: SystemLogChange[] | null;
    reason: string | null;
}

/** 复合游标：本批末条 (occurredAt, id)；还有下一批时非空 */
export interface SystemLogCursor {
    at: string;
    id: string;
}

export interface SystemLogPage {
    items: SystemLogEntry[];
    nextCursor: SystemLogCursor | null;
}

/** 系统日志查询参数（时间范围见 range；custom 时 from/to 必填且 from ≤ to） */
export interface SystemLogQuery {
    domain?: SystemLogDomain;
    action?: SystemLogAction;
    /** 操作人筛选（用户账号；姓名可重名，账号唯一） */
    operator?: string;
    range: "today" | "7d" | "30d" | "custom";
    from?: string;
    to?: string;
    keyword?: string;
    limit?: number;
    beforeAt?: string;
    beforeId?: string;
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

/** 登录用户 + 其角色的授权（对应 sys_grant 按 role 下发）；
 *  protectedCodes 为当前受保护权限码（运行时真源，侧边栏标签等展示口径用） */
export interface ProfileResult {
    user: WbUser;
    grant: RoleGrant;
    protectedCodes?: string[];
}

/** 授权变更日志条目 */
export interface GrantLogEntry {
    time: string;
    user: string;
    text: string;
}

/** 权限目录条目（GET /permissions/catalog）：protected 为运行时受保护状态 */
export interface PermissionCatalogEntry {
    code: string;
    kind: "MENU" | "ACTION";
    menuKey: string;
    actionId: string | null;
    label: string;
    protected: boolean;
}

/** PATCH /permissions/catalog/:code/protected 入参（仅 super 角色） */
export interface SetPermissionProtectionInput {
    protected: boolean;
    reason?: string;
}

/** 保护开关审计条目（与 GrantLogEntry 同形态，文案服务端拼装） */
export interface ProtectionLogEntry {
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

/** 客户与 BOM 仅在订单净出库为 0 且无未删除出库单时可改（后端守卫） */
export interface UpdateOrderInput {
    expectedVersion: number;
    customerCode?: string;
    bomCode?: string;
    qty?: number;
    deliverDate?: string;
    remark?: string;
}

/** 归档订单仅限超级管理员；备注选填（留空不上送） */
export interface ArchiveOrderInput {
    expectedVersion: number;
    reason?: string;
}

/** 回退归档仅限归档操作人本人（超级管理员）；备注选填（留空不上送） */
export interface UnarchiveOrderInput {
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

/** 删除客户仅限超级管理员，须无任何销售订单（已删除订单物理消失，视同无订单） */
export interface DeleteCustomerInput {
    expectedVersion: number;
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

/* ---------- 系统备份/恢复 ---------- */

/** 备份分组目录（后端 backup.catalog 单一来源） */
export interface BackupGroupDef {
    key: string;
    label: string;
    tables: string[];
    dependsOn: string[];
}

export interface BackupCatalog {
    groups: BackupGroupDef[];
    allGroupKeys: string[];
}

export interface BackupPreviewMeta {
    format: string;
    version: number;
    createdAt: string;
    groups: string[];
    serverProduct: string;
    serverVersion: string;
    latestMigration: string;
    schemaFingerprint: string;
    tables: Array<{ name: string; rowCount: number }>;
}

export interface BackupPreviewResult {
    meta: BackupPreviewMeta;
    canReplace: boolean;
    tables: Array<{ name: string; rowCount: number; insertStatements: number }>;
}

export type RestoreMode = "merge" | "replace";
export type RestoreJobStatus = "RUNNING" | "UNKNOWN" | "SUCCEEDED" | "SUCCEEDED_AUDIT_FAILED" | "FAILED";

export interface RestoreJob {
    jobId: string;
    requestKey: string;
    mode: RestoreMode;
    status: RestoreJobStatus;
    report: {
        mode: RestoreMode;
        startedAt: string;
        finishedAt: string;
        tables?: Array<{ name: string; inserted: number; skipped: number; sequenceRaised?: number }>;
        tokenVersionsRaised?: number;
        apiIdempotencyPurged?: number;
    } | null;
    errorText: string;
    createdAt: string;
    finishedAt: string | null;
}

/* ---------- AI 工作台 / 对话代理（契约 ai tag） ---------- */

export interface AiStatus {
    enabled: boolean;
    configured: boolean;
    model: string;
}

export interface AiSettingsView {
    baseUrl: string;
    model: string;
    enabled: boolean;
    apiKeySet: boolean;
    apiKeyMasked: string | null;
    updatedAt: string | null;
    updatedByName: string | null;
}

export interface AiSettingsUpdateInput {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    enabled?: boolean;
}

export interface AiTestResult {
    ok: boolean;
    latencyMs: number;
    message: string;
    model: string | null;
}

export interface AiBalanceInfo {
    /** 上游口径：账户余额是否足以继续调用 */
    isAvailable: boolean;
    currency: string;
    /** 总可用余额（元；充值 + 未过期赠送） */
    totalBalance: number;
    grantedBalance: number;
    toppedUpBalance: number;
}

export interface AiUsageUserRow {
    userId: string;
    account: string;
    name: string;
    /** 时间范围内消耗金额（元；按模型单价折算的估算值，保留 4 位小数，展示两位） */
    amount: number;
    lastUsedAt: string | null;
}

export interface AiUsageSummary {
    from: string;
    to: string;
    totals: { amount: number };
    users: AiUsageUserRow[];
}
