import { env } from "@/env";
import { ApiError, requestClient } from "@/http";
import { clearToken, getToken } from "@/lib/token";
import type { ChatToolDefinition, ChatUsage, ChatWireMessage, ToolCall } from "@/components/ai/types";

export function fetchAiDocs(
    signal?: AbortSignal,
): Promise<{ root: string; topics: Array<{ id: string; title: string; whenToUse: string }> }> {
    return requestClient.get("/ai/agent/docs", { signal });
}

/** 与页面查询共用鉴权、错误处理和缓存语义；路径由本地只读目录决定。 */
export function fetchAiQuery(path: string, signal: AbortSignal): Promise<unknown> {
    return requestClient.get(path, { signal });
}

export async function consumeAiStream(
    response: Response,
    onText: (text: string) => void,
): Promise<{ content: string; toolCalls: ToolCall[]; usage?: ChatUsage; finishReason: string | null }> {
    if (!response.body) throw new Error("AI 未返回响应内容，请重试");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const calls = new Map<number, ToolCall>();
    let pending = "";
    let content = "";
    let usage: ChatUsage | undefined;
    let finishReason: string | null = null;
    let done = false;
    const frame = (text: string) => {
        const lines = text.split("\n");
        const event = lines
            .find(line => line.startsWith("event:"))
            ?.slice(6)
            .trim();
        const data = lines
            .filter(line => line.startsWith("data:"))
            .map(line => line.slice(5).trimStart())
            .join("\n");
        if (!data) return;
        if (data.trim() === "[DONE]") {
            done = true;
            return;
        }
        const payload = JSON.parse(data);
        if (event === "error" || payload.error)
            throw new Error(payload.message ?? payload.error?.message ?? "AI 回答中断，请重试");
        if (event === "usage") {
            usage = payload as ChatUsage;
            return;
        }
        const choice = payload.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta;
        if (typeof delta?.content === "string") {
            content += delta.content;
            onText(content);
        }
        for (const part of delta?.tool_calls ?? []) {
            if (!Number.isInteger(part.index) || part.index < 0 || part.index >= 16)
                throw new Error("AI 返回了无效的查询指令");
            const call = calls.get(part.index) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
            if (part.id) call.id = part.id;
            call.function.name += part.function?.name ?? "";
            call.function.arguments += part.function?.arguments ?? "";
            if (call.function.arguments.length > 16_000) throw new Error("AI 查询条件过长，请缩小查询范围");
            calls.set(part.index, call);
        }
    };
    try {
        while (!done) {
            const chunk = await reader.read().catch(() => {
                throw new Error("网络连接中断，请检查网络后重试");
            });
            pending += decoder.decode(chunk.value, { stream: !chunk.done });
            pending = pending.replace(/\r\n/g, "\n");
            let boundary: number;
            while ((boundary = pending.indexOf("\n\n")) >= 0) {
                frame(pending.slice(0, boundary));
                pending = pending.slice(boundary + 2);
            }
            if (pending.length > 1_048_576) throw new Error("AI 响应格式异常，请重试");
            if (chunk.done) {
                if (pending.trim()) frame(pending);
                break;
            }
        }
        if (!done) throw new Error("AI 连接提前中断，请重试");
        const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
        if (toolCalls.some(call => !call.id || !call.function.name)) throw new Error("AI 查询指令不完整，请重试");
        return { content, toolCalls, usage, finishReason };
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

export async function streamAiChat(
    messages: ChatWireMessage[],
    tools: ChatToolDefinition[],
    signal: AbortSignal,
    onText: (text: string) => void,
) {
    const body = JSON.stringify({ messages, tools });
    if (new TextEncoder().encode(body).byteLength > 1_000_000)
        throw new Error("本轮资料过多，请减少附件或缩小查询范围后重试");
    const response = await fetch(`${env.VITE_API_BASE_URL.replace(/\/$/, "")}/ai/chat/stream`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
            authorization: `Bearer ${getToken() ?? ""}`,
        },
        body,
        signal,
    }).catch((error: unknown) => {
        if (signal.aborted) throw error;
        throw new ApiError("网络连接失败，请检查网络后重试", -1);
    });
    if (!response.ok) {
        let message =
            response.status === 413 ? "本轮资料过多，请减少附件或缩小查询范围" : `AI 请求失败（${response.status}）`;
        try {
            message = (await response.json()).message || message;
        } catch {
            /* 保留状态码说明 */
        }
        if (response.status === 401) {
            clearToken();
            window.location.replace("/login");
        }
        throw new ApiError(message, response.status);
    }
    return consumeAiStream(response, onText);
}
