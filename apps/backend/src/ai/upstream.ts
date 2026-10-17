/** OpenAI 兼容上游的共用工具（chat 代理与连通测试共用；模块内共享层） */
import type { AiChatUsage } from "./types";

/** 运行时配置（ai_provider_config 单行的内存形态） */
export interface ProviderRuntimeConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    enabled: boolean;
}

/** 上游 /chat/completions 的最小响应结构（非流式；含工具调用） */
export interface UpstreamChatPayload {
    choices?: Array<{
        message?: {
            content?: string | null;
            tool_calls?: Array<{
                id?: string;
                type?: string;
                function?: { name?: string; arguments?: string };
            }>;
        };
        finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/** SSE 直通的响应头（Nginx 不缓冲，逐块下发） */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "x-accel-buffering": "no",
};

export const chatCompletionsUrl = (baseUrl: string): string => `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

/** 上游 /user/balance（DeepSeek 余额查询；OpenAI 兼容生态里的 DeepSeek 扩展端点） */
export const balanceUrl = (baseUrl: string): string => `${baseUrl.replace(/\/+$/, "")}/user/balance`;

/** 上游错误响应 → 中文错误文案（截断至 300 字符，防止错误页超长） */
export async function readUpstreamError(response: Response): Promise<string> {
    const status = response.status;
    let detail = "";
    try {
        const text = (await response.text()).slice(0, 300);
        try {
            const parsed = JSON.parse(text) as { error?: { message?: string } };
            detail = parsed.error?.message ?? text;
        } catch {
            detail = text;
        }
    } catch {
        // 读不到 body 时只报状态码
    }
    return detail ? `AI 上游返回 HTTP ${status}：${detail}` : `AI 上游返回 HTTP ${status}`;
}

export function upstreamFailureMessage(error: unknown): string {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
        return "AI 上游请求超时或被中止";
    }
    return `AI 上游连接失败：${error instanceof Error ? error.message : String(error)}`;
}

/** 只接受非负安全整数；缺失或无效字段不视为已知的零。两项明细齐全时可推导 total。 */
export function normalizeUsage(raw: UpstreamChatPayload["usage"] | undefined): AiChatUsage | null {
    const tokenCount = (value: unknown): number | null =>
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
    const prompt = tokenCount(raw?.prompt_tokens);
    const completion = tokenCount(raw?.completion_tokens);
    const total = tokenCount(raw?.total_tokens);
    if (prompt === null && completion === null && total === null) {
        return null;
    }
    const sum = (prompt ?? 0) + (completion ?? 0);
    return {
        status: prompt !== null && completion !== null && (total === null || total === sum) ? "known" : "partial",
        promptTokens: prompt ?? 0,
        completionTokens: completion ?? 0,
        totalTokens: Math.max(total ?? 0, sum),
    };
}

/**
 * SSE 流式嗅探：解析完整行的 data: 载荷，捕获 usage（OpenAI 兼容流在末尾
 * stream_options.include_usage=true 时会补一帧含 usage 的 chunk）。
 * 返回未完成的跨块残行，供下一块续接；无法解析的行静默忽略。
 */
export const sniffSseUsage = (pending: string, capture: (usage: AiChatUsage) => void): string => {
    const lines = pending.split("\n");
    const rest = lines.pop() ?? "";
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
            continue;
        }
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") {
            continue;
        }
        try {
            const parsed = JSON.parse(payload) as UpstreamChatPayload;
            const usage = normalizeUsage(parsed.usage);
            if (usage) {
                capture(usage);
            }
        } catch {
            // 非 JSON 行（上游注释心跳等）忽略
        }
    }
    return rest;
};
