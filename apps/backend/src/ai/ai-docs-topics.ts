/** agent 文档主题注册表 + AI 模块常量。
 *  文档正文单一归属在仓库 docs/ 下（docs/ai/ 新建三篇 + docs/business/ 复用三篇），
 *  本注册表只做 id → 文件的路由；标题/whenToUse 变更时同步 docs/ai/agent-guide.md
 *  的任务索引（根文档会整篇注入 system prompt，主题按 GET /ai/agent/docs/:id 拉取）。
 *  运行时按仓库布局解析（开发 apps/backend、容器 /app/apps/backend，均取
 *  ../../docs），部署镜像经 Dockerfile.backend COPY docs 进容器（staging 与
 *  dockerignore 须同步放行，见 scripts/deploy/）。 */

export interface AiDocTopic {
    id: string;
    title: string;
    whenToUse: string;
    /** 相对仓库 docs/ 目录的路径 */
    file: string;
}

/** 根文档（manifest 的 root 字段）：系统概览 + 「用户问什么 → 读哪篇」任务路由 */
export const AI_DOC_ROOT_FILE = "ai/agent-guide.md";

export const AI_DOC_TOPICS: readonly AiDocTopic[] = [
    {
        id: "endpoints",
        title: "AI 查询端点目录",
        whenToUse: "需要查业务数据、作废数据、删除审计或系统日志，选接口、看口径与权限约束时",
        file: "ai/endpoints.md",
    },
    {
        id: "operations",
        title: "系统操作指南",
        whenToUse: "用户问某操作怎么做、删除/作废/归档的前置条件、失败原因时",
        file: "ai/operations.md",
    },
    {
        id: "process",
        title: "业务流程主线",
        whenToUse: "理解客户建档→开单→入库→发货的业务链路与系统边界时",
        file: "business/process.md",
    },
    {
        id: "roles",
        title: "角色与权限规则",
        whenToUse: "判断某操作需要什么角色/权限、哪些操作仅超级管理员、数据可见范围时",
        file: "business/roles.md",
    },
    {
        id: "analytics",
        title: "分析页与关系数据口径",
        whenToUse: "使用 GET /workbench/relations 时（facts 字段、状态分桶、过载上限）",
        file: "business/analytics-relations.md",
    },
] as const;

/** 未配置时的默认模型（API ID；AI 工作台可改）。展示名为 DeepSeek V4.1-Flash，
 *  官方 list-models 现行 ID 为 deepseek-flash */
export const DEFAULT_AI_MODEL = "deepseek-flash";

/** 对话代理限制（DTO 之外的服务端兜底）：
 *  - timeoutMs 45s 同时是非流式/流式的上游时限，须小于恢复维护的写排空窗 60s
 *    （system.service.ts DRAIN_TIMEOUT_MS），在途 AI 请求不会阻塞恢复；
 *  - maxMessages × messageMaxChars（40 条，容纳工具调用循环）是字符数限制；JSON 字节体积仍受 Fastify 默认
 *    1MiB bodyLimit 约束（超限 413），异常转义编码可放大体积，故不承诺由字符数
 *    推导的字节上限。 */
export const AI_CHAT_LIMITS = {
    timeoutMs: 45_000,
    messageMaxChars: 16_000,
    maxMessages: 40,
    /** 上游补全输出上限（控制单请求成本） */
    maxCompletionTokens: 4096,
} as const;
