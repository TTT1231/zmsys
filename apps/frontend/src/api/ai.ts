import { requestClient } from "@/http";
import type {
    AiBalanceInfo,
    AiSettingsUpdateInput,
    AiSettingsView,
    AiStatus,
    AiTestResult,
    AiUsageSummary,
} from "./types";

/** AI 面板状态点（登录即可）：只看本地配置态，不探测上游 */
export function fetchAiStatus(): Promise<AiStatus> {
    return requestClient.get<AiStatus>("/ai/status");
}

/** AI 工作台配置读取（menu:ai-workbench）；apiKey 只回脱敏视图，永不透出原文 */
export function fetchAiSettings(): Promise<AiSettingsView> {
    return requestClient.get<AiSettingsView>("/ai/admin/settings");
}

/** AI 工作台配置保存（部分更新：省略字段保持原值，apiKey 空串 = 显式清除） */
export function updateAiSettings(input: AiSettingsUpdateInput): Promise<AiSettingsView> {
    return requestClient.put<AiSettingsView>("/ai/admin/settings", input);
}

/** AI 上游连通测试：以最小补全探测已保存配置；未保存配置时后端 400 */
export function testAiConnection(): Promise<AiTestResult> {
    return requestClient.post<AiTestResult>("/ai/admin/test");
}

/** AI 上游账户余额（DeepSeek /user/balance 转发，单位元）；未保存配置时后端 400 */
export function fetchAiBalance(): Promise<AiBalanceInfo> {
    return requestClient.get<AiBalanceInfo>("/ai/admin/balance");
}

/** AI 用量统计（按人聚合消耗金额）；range=custom 时 from/to 含当日 */
export function fetchAiUsage(query: {
    range: "today" | "7d" | "30d" | "custom";
    from?: string;
    to?: string;
}): Promise<AiUsageSummary> {
    const params = new URLSearchParams();
    params.set("range", query.range);
    if (query.range === "custom") {
        if (query.from) params.set("from", query.from);
        if (query.to) params.set("to", query.to);
    }
    return requestClient.get<AiUsageSummary>(`/ai/admin/usage?${params.toString()}`);
}
