/** AI 助手模块的对外契约类型（契约 ai tag）：agent 查询、对话代理与工作台管理。
 *  与前端 src/api/types.ts 的 AI 类型同构，openapi.yaml schemas 一一对应。 */

// ---------- agent 文档 ----------

export interface AiDocTopicMeta {
    id: string;
    title: string;
    /** 何时读这篇（agent 按需取文档的路由提示） */
    whenToUse: string;
}

/** GET /ai/agent/docs：清单 + 根文档正文（根文档常驻注入 system prompt，主题按需拉取） */
export interface AiDocsManifest {
    root: string;
    topics: AiDocTopicMeta[];
}

/** GET /ai/agent/docs/:topicId */
export interface AiDocContent {
    id: string;
    title: string;
    markdown: string;
}

// ---------- 作废数据查询 ----------

export interface VoidedInboundItem {
    id: string;
    entryNo: string;
    bomCode: string;
    bomName: string;
    qty: number;
    businessDate: string;
    remark: string;
    status: "voided";
    voidedBy: string;
    voidedAt: string;
    voidReason: string | null;
}

export interface VoidedInboundPage {
    items: VoidedInboundItem[];
    total: number;
}

export interface VoidedOutboundItem {
    id: string;
    shipmentNo: string;
    orderNo: string;
    customerName: string;
    bomCode: string;
    bomName: string;
    qty: number;
    businessDate: string;
    status: "voided";
    voidedBy: string;
    voidedAt: string;
    voidReason: string | null;
}

export interface VoidedOutboundPage {
    items: VoidedOutboundItem[];
    total: number;
}

// ---------- 已删除数据查询（op_log delete_* 快照） ----------

export type DeletedDomain = "customer" | "order" | "bom" | "bom_structure" | "inbound" | "outbound";

export interface DeletedRecordItem {
    id: string;
    occurredAt: string;
    /** 原始 op_log 动作（delete_order / delete_inbound / ...） */
    action: string;
    domain: DeletedDomain;
    targetCode: string;
    operator: { name: string; role: string };
    /** 删除前全量快照（结构因动作而异，见 domain/snapshots.ts；物理删除后唯一留存） */
    detail: unknown;
}

export interface DeletedRecordPage {
    items: DeletedRecordItem[];
    nextCursor: { at: string; id: string } | null;
}

// ---------- 对话代理 ----------

export interface AiChatUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

/** POST /ai/chat（非流式信封返回）；流式走 /ai/chat/stream 的 SSE 直通（不走信封） */
export interface AiChatResult {
    content: string;
    model: string;
    finishReason: string | null;
    usage: AiChatUsage;
}

/** GET /ai/status：AI 面板状态点（不探测上游，只看本地配置态） */
export interface AiStatus {
    enabled: boolean;
    configured: boolean;
    model: string;
}

// ---------- AI 工作台管理（默认仅超管，受保护权限 menu:ai-workbench） ----------

export interface AiSettingsView {
    baseUrl: string;
    model: string;
    enabled: boolean;
    apiKeySet: boolean;
    apiKeyMasked: string | null;
    updatedAt: string | null;
    updatedByName: string | null;
}

export interface AiTestResult {
    ok: boolean;
    latencyMs: number;
    message: string;
    model: string | null;
}

export interface AiUsageUserRow {
    userId: string;
    account: string;
    name: string;
    role: string;
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    lastUsedAt: string | null;
}

export interface AiUsageDayRow {
    date: string;
    requests: number;
    totalTokens: number;
}

export interface AiUsageSummary {
    from: string;
    to: string;
    totals: {
        requests: number;
        successRequests: number;
        errorRequests: number;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    users: AiUsageUserRow[];
    byDay: AiUsageDayRow[];
}
