import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service";
import type { SnowflakeGenerator } from "../common/snowflake";
import type { AuthUser } from "../common/types/auth-user";
import { AiChatService } from "./ai-chat.service";

const actor = { id: "1" } as AuthUser;
const dto = { messages: [{ role: "user" as const, content: "查订单" }] };

function setup() {
    const create = vi.fn().mockResolvedValue({});
    const prisma = {
        aiProviderConfig: {
            findUnique: vi.fn().mockResolvedValue({
                enabled: true,
                baseUrl: "https://example.invalid/v1",
                apiKey: "test",
                model: "test",
            }),
        },
        aiUsageLog: { create },
    } as unknown as PrismaService;
    const service = new AiChatService(prisma, { next: () => 1n } as SnowflakeGenerator);
    const request = { raw: new EventEmitter() };
    const raw = Object.assign(new EventEmitter(), {
        destroyed: false,
        writeHead: vi.fn(),
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(),
    });
    const output = () => raw.write.mock.calls.map(([chunk]) => String(chunk)).join("");
    return { service, create, request, raw, output };
}

afterEach(() => vi.unstubAllGlobals());

describe("AI 对话代理", () => {
    it("上游工具调用格式错误时只落账一次，保留已取得用量", async () => {
        const { service, create } = setup();
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                Response.json({
                    choices: [{ message: { tool_calls: {} } }],
                    usage: { prompt_tokens: 10, completion_tokens: 5 },
                }),
            ),
        );
        await expect(service.chat(dto, actor)).rejects.toThrow("工具调用格式无效");
        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0]![0].data).toMatchObject({ status: "error", totalTokens: 15 });
    });
    it.each([undefined, {}])("HTTP 成功但 usage 无效时调用者与日志均可识别未知：%j", async usage => {
        const { service, create } = setup();
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: "回答" } }], usage })),
        );
        const result = await service.chat(dto, actor);
        expect(result.usage).toEqual({ status: "unknown", promptTokens: 0, completionTokens: 0, totalTokens: 0 });
        expect(create.mock.calls[0]![0].data.errorMessage).toContain("用量未知");
    });

    it("部分 usage 保留有效数值与注记", async () => {
        const { service, create } = setup();
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValue(
                    Response.json({ choices: [{ message: { content: "回答" } }], usage: { total_tokens: 15 } }),
                ),
        );
        expect((await service.chat(dto, actor)).usage).toMatchObject({ status: "partial", totalTokens: 15 });
        expect(create.mock.calls[0]![0].data.errorMessage).toContain("用量部分未知");
    });

    it("流式完整用量在 DONE 前下发，中文跨块保持完整", async () => {
        const { service, create, request, raw, output } = setup();
        const bytes = new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"成品库存"}}]}\n\ndata: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\ndata: [DONE]\n\n',
        );
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
                controller.close();
            },
        });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
        await service.streamChat(dto, actor, request, { raw });
        expect(output()).toContain("成品库存");
        expect(output()).toContain('"status":"known"');
        expect(output().indexOf("event: usage")).toBeLessThan(output().indexOf("[DONE]"));
        expect(create.mock.calls[0]![0].data).toMatchObject({ status: "success", totalTokens: 15, errorMessage: null });
    });

    it("取得用量后断流仍保留 15 token，并记录 error", async () => {
        const { service, create, request, raw, output } = setup();
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(new Response('data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n')),
        );
        await service.streamChat(dto, actor, request, { raw });
        expect(output()).toContain("event: error");
        expect(output()).not.toContain("[DONE]");
        expect(create.mock.calls[0]![0].data).toMatchObject({ status: "error", totalTokens: 15 });
    });

    it("客户端在等待背压期间断开可立即结束请求并落账", async () => {
        const { service, create, request, raw } = setup();
        raw.write.mockImplementation(() => {
            queueMicrotask(() => {
                raw.destroyed = true;
                raw.emit("close");
            });
            return false;
        });
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"回答"}}]}\n\n')),
        );
        await service.streamChat(dto, actor, request, { raw });
        expect(create.mock.calls[0]![0].data).toMatchObject({ status: "error", totalTokens: 0 });
        expect(raw.listenerCount("drain")).toBe(0);
        expect(request.raw.listenerCount("aborted")).toBe(0);
    });
});
