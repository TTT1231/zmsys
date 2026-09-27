import { requestClient } from "@/http";
import type { SystemLogPage, SystemLogQuery } from "./types";

/** 系统日志时间线（仅超级管理员）；分批为 (beforeAt, beforeId) 复合游标追加语义 */
export function fetchSystemLogs(query: SystemLogQuery): Promise<SystemLogPage> {
    const params = new URLSearchParams();
    if (query.domain) params.set("domain", query.domain);
    if (query.action) params.set("action", query.action);
    params.set("range", query.range);
    if (query.range === "custom") {
        if (query.from) params.set("from", query.from);
        if (query.to) params.set("to", query.to);
    }
    if (query.keyword) params.set("keyword", query.keyword);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.beforeAt) params.set("beforeAt", query.beforeAt);
    if (query.beforeId) params.set("beforeId", query.beforeId);
    return requestClient.get<SystemLogPage>(`/system-logs?${params.toString()}`);
}
