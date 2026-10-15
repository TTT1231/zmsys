import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SnowflakeGenerator } from "../common/snowflake";
import type { AuthUser } from "../common/types/auth-user";
import { AI_CHAT_LIMITS, DEFAULT_AI_MODEL } from "./ai-docs-topics";
import type { ChatRequestDto } from "./dto/chat.dto";
import type { AiChatResult, AiChatUsage, AiStatus } from "./types";
import {
    chatCompletionsUrl,
    normalizeUsage,
    readUpstreamError,
    sniffSseUsage,
    SSE_HEADERS,
    upstreamFailureMessage,
    type ProviderRuntimeConfig,
    type UpstreamChatPayload,
} from "./upstream";

/** 流式端点的最小 Fastify 结构类型（仓库惯例：不直接依赖 fastify 包类型） */
export interface SseReplyLike {
    raw: {
        writeHead(status: number, headers: Record<string, string>): unknown;
        write(chunk: Buffer): boolean;
        end(): unknown;
        once(event: "drain" | "close", listener: () => void): unknown;
        removeListener(event: "drain" | "close", listener: () => void): unknown;
        readonly destroyed: boolean;
    };
}

export interface StreamRequestLike {
    raw: {
        on(event: "aborted", listener: () => void): unknown;
        removeListener(event: "aborted", listener: () => void): unknown;
    };
}

/**
 * AI 对话代理（契约 /ai/chat*）：后端转发 OpenAI 兼容上游并按登录人记账 token
 * （纯前端转发做不到按人计量）。已取得的 usage 无论成功或失败都保留；缺失或
 * 部分未知写入日志注记，并通过响应的 usage.status 告知调用方。
 * handler Promise 在上游结束/中止并完成记账后才收尾，与维护态写登记生命周期一致
 * （45s 上限 < 恢复排空窗 60s，在途请求不会阻塞恢复）。
 */
@Injectable()
export class AiChatService {
    private readonly logger = new Logger(AiChatService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly snowflake: SnowflakeGenerator,
    ) {}

    /** GET /ai/status：AI 面板状态点（只看本地配置态，不探测上游） */
    async status(): Promise<AiStatus> {
        const config = await this.loadConfig();
        return {
            enabled: config?.enabled ?? false,
            configured: Boolean(config?.baseUrl && config.apiKey),
            model: config?.model ?? DEFAULT_AI_MODEL,
        };
    }

    /** POST /ai/chat：非流式，正常信封返回 */
    async chat(dto: ChatRequestDto, actor: AuthUser): Promise<AiChatResult> {
        const config = await this.requireConfig();
        const startedAt = Date.now();
        let usage: AiChatUsage | null = null;
        try {
            const response = await this.fetchUpstream(
                config,
                dto,
                false,
                AbortSignal.timeout(AI_CHAT_LIMITS.timeoutMs),
            );
            if (!response.ok) {
                throw new Error(await readUpstreamError(response));
            }
            const payload = (await response.json()) as UpstreamChatPayload;
            usage = normalizeUsage(payload.usage);
            const choice = payload.choices?.[0];
            if (!choice?.message) {
                throw new Error("AI 上游未返回有效回答，请重试");
            }
            const rawToolCalls = choice.message.tool_calls ?? [];
            if (!Array.isArray(rawToolCalls)) throw new Error("AI 上游返回的工具调用格式无效，请重试");
            const toolCalls = rawToolCalls
                .filter(
                    (call): call is { id: string; type: "function"; function: { name: string; arguments: string } } =>
                        Boolean(call.id && call.function?.name),
                )
                .map(call => ({
                    id: call.id,
                    type: "function" as const,
                    function: { name: call.function.name, arguments: call.function.arguments ?? "{}" },
                }));
            const content = typeof choice.message.content === "string" ? choice.message.content : "";
            if (!content.trim() && !toolCalls.length) throw new Error("AI 上游未返回有效回答，请重试");
            await this.logUsage(actor.id, config.model, usage, "success", null, Date.now() - startedAt);
            return {
                content,
                model: config.model,
                finishReason: choice?.finish_reason ?? null,
                usage: usage ?? { status: "unknown", promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                ...(toolCalls.length ? { toolCalls } : {}),
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : upstreamFailureMessage(error);
            await this.logUsage(actor.id, config.model, usage, "error", message, Date.now() - startedAt);
            throw new BadGatewayException(message);
        }
    }

    /**
     * POST /ai/chat/stream：SSE 直通上游（不走 {code,data,message} 信封）。
     * 响应头发出前上游失败 → 正常 502 信封；发出后 → SSE `event: error` 后关闭。
     * 客户端断线 → 中止上游请求并按 error 记账（用量未知）。
     */
    async streamChat(
        dto: ChatRequestDto,
        actor: AuthUser,
        request: StreamRequestLike,
        reply: SseReplyLike,
    ): Promise<void> {
        const config = await this.requireConfig();
        const startedAt = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), AI_CHAT_LIMITS.timeoutMs);
        const onClientClose = (): void => controller.abort();
        request.raw.on("aborted", onClientClose);
        reply.raw.once("close", onClientClose);
        let usage: AiChatUsage | null = null;
        let headersSent = false;
        let settled = false;
        const finish = async (errorMessage: string | null): Promise<void> => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            request.raw.removeListener("aborted", onClientClose);
            reply.raw.removeListener("close", onClientClose);
            // 先落账、后收尾流：避免「响应已结束但用量尚未入库」的窗口。
            await this.logUsage(
                actor.id,
                config.model,
                usage,
                errorMessage === null ? "success" : "error",
                errorMessage,
                Date.now() - startedAt,
            );
            if (headersSent && !reply.raw.destroyed) {
                try {
                    const reportedUsage: AiChatUsage = usage ?? {
                        status: "unknown",
                        promptTokens: 0,
                        completionTokens: 0,
                        totalTokens: 0,
                    };
                    reply.raw.write(Buffer.from(`event: usage\ndata: ${JSON.stringify(reportedUsage)}\n\n`));
                    if (errorMessage !== null) {
                        // 头已发出，不能再改 HTTP 状态码：以 SSE 错误事件收尾
                        reply.raw.write(
                            Buffer.from(`event: error\ndata: ${JSON.stringify({ message: errorMessage })}\n\n`),
                        );
                    } else {
                        reply.raw.write(Buffer.from("data: [DONE]\n\n"));
                    }
                    reply.raw.end();
                } catch {
                    // 客户端已断开，写入失败无需处理
                }
            }
        };
        try {
            const response = await this.fetchUpstream(config, dto, true, controller.signal);
            if (!response.ok) {
                // 头未发出：走正常异常过滤器，回 502 信封
                throw new BadGatewayException(await readUpstreamError(response));
            }
            if (!response.body) {
                throw new BadGatewayException("AI 上游未返回流式响应体");
            }
            reply.raw.writeHead(200, { ...SSE_HEADERS });
            headersSent = true;
            let pending = "";
            let done = false;
            const decoder = new TextDecoder();
            const forwardFrame = async (frame: string): Promise<void> => {
                const data = frame
                    .split("\n")
                    .filter(line => line.startsWith("data:"))
                    .map(line => line.slice(5).trimStart())
                    .join("\n");
                if (data.trim() === "[DONE]") {
                    done = true;
                    return;
                }
                if (data) {
                    let parsed: { error?: { message?: string } } | null = null;
                    try {
                        parsed = JSON.parse(data) as { error?: { message?: string } };
                    } catch {
                        /* 心跳或非 JSON 数据原样转发 */
                    }
                    if (parsed?.error) throw new Error(parsed.error.message ?? "AI 上游流式响应失败");
                }
                sniffSseUsage(`${frame}\n`, captured => {
                    usage = captured;
                });
                if (!reply.raw.write(Buffer.from(`${frame}\n\n`))) {
                    await new Promise<void>((resolve, reject) => {
                        const cleanup = (): void => {
                            reply.raw.removeListener("drain", onDrain);
                            controller.signal.removeEventListener("abort", onAbort);
                        };
                        const onDrain = (): void => {
                            cleanup();
                            resolve();
                        };
                        const onAbort = (): void => {
                            cleanup();
                            reject(new Error("流式请求已中止"));
                        };
                        reply.raw.once("drain", onDrain);
                        controller.signal.addEventListener("abort", onAbort, { once: true });
                        if (controller.signal.aborted) onAbort();
                    });
                }
            };
            for await (const chunk of response.body) {
                controller.signal.throwIfAborted();
                pending += decoder.decode(chunk as Uint8Array, { stream: true });
                pending = pending.replace(/\r\n/g, "\n");
                let boundary: number;
                while ((boundary = pending.indexOf("\n\n")) >= 0) {
                    const frame = pending.slice(0, boundary);
                    pending = pending.slice(boundary + 2);
                    await forwardFrame(frame);
                }
                if (pending.length > 1_048_576) throw new Error("AI 上游流式数据格式无效");
                if (done) break;
            }
            pending += decoder.decode();
            if (!done && pending.trim()) await forwardFrame(pending);
            controller.signal.throwIfAborted();
            if (!done) throw new Error("AI 上游响应提前结束，请重试");
            await finish(null);
        } catch (error) {
            // 响应头尚未发出（fetch 连接失败/上游非 2xx）：客户端还没收到任何字节，
            // 必须走正常异常过滤器回 502 信封——吞掉会让客户端永远挂起
            if (!headersSent) {
                const message = error instanceof BadGatewayException ? error.message : upstreamFailureMessage(error);
                await finish(message);
                throw error instanceof BadGatewayException ? error : new BadGatewayException(message);
            }
            // 头已发出：只能以 SSE 错误事件收尾（见 finish），不改 HTTP 状态码
            const message = upstreamFailureMessage(error);
            await finish(reply.raw.destroyed ? `客户端断开：${message}` : message);
        }
    }

    private async loadConfig(): Promise<ProviderRuntimeConfig | null> {
        const row = await this.prisma.aiProviderConfig.findUnique({ where: { id: 1 } });
        return row ? { baseUrl: row.baseUrl, apiKey: row.apiKey, model: row.model, enabled: row.enabled } : null;
    }

    /** 配置缺失或停用统一 503，文案引导联系超管（这也是 agent 侧的"提醒"机制） */
    private async requireConfig(): Promise<ProviderRuntimeConfig> {
        const config = await this.loadConfig();
        if (!config || !config.enabled || !config.baseUrl || !config.apiKey) {
            throw new ServiceUnavailableException("AI 服务未配置或未启用，请联系超级管理员在「AI 工作台」维护配置");
        }
        return config;
    }

    private async fetchUpstream(
        config: ProviderRuntimeConfig,
        dto: ChatRequestDto,
        stream: boolean,
        signal: AbortSignal,
    ): Promise<Response> {
        const body: Record<string, unknown> = {
            model: config.model,
            messages: dto.messages,
            max_tokens: AI_CHAT_LIMITS.maxCompletionTokens,
        };
        if (dto.tools?.length) {
            // 工具目录原样透传（agent 编排：模型发起 tool_calls → 前端执行 → role=tool 回传）
            body.tools = dto.tools;
            if (dto.tool_choice !== undefined) {
                body.tool_choice = dto.tool_choice;
            }
        }
        if (stream) {
            // include_usage：末尾补一帧含 usage 的 chunk，供流式记账
            body.stream = true;
            body.stream_options = { include_usage: true };
        }
        return fetch(chatCompletionsUrl(config.baseUrl), {
            method: "POST",
            headers: {
                authorization: `Bearer ${config.apiKey}`,
                "content-type": "application/json",
            },
            body: JSON.stringify(body),
            signal,
        });
    }

    /** 记账失败只记日志不阻断请求/流（用量统计缺失可容忍，主流程不可断） */
    private async logUsage(
        userId: string,
        model: string,
        usage: AiChatUsage | null,
        status: "success" | "error",
        errorMessage: string | null,
        durationMs: number,
    ): Promise<void> {
        const usageNote =
            !usage || usage.status === "unknown" ? "用量未知" : usage.status === "partial" ? "用量部分未知" : null;
        const note = [usageNote, errorMessage].filter(Boolean).join("；") || null;
        try {
            await this.prisma.aiUsageLog.create({
                data: {
                    id: this.snowflake.next(),
                    userId: BigInt(userId),
                    model,
                    promptTokens: usage?.promptTokens ?? 0,
                    completionTokens: usage?.completionTokens ?? 0,
                    totalTokens: usage?.totalTokens ?? 0,
                    status,
                    errorMessage: note?.slice(0, 500) ?? null,
                    durationMs,
                    createdAt: new Date(),
                },
            });
        } catch (error) {
            this.logger.error(`AI 用量记账失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
