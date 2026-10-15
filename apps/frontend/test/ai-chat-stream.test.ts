import { describe, expect, it } from "vitest";
import { consumeAiStream } from "@/api/ai-chat";

describe("AI 流式响应", () => {
    it("中文跨字节与跨帧解析，并拼接分块工具参数", async () => {
        const data =
            'data: {"choices":[{"delta":{"content":"成品库存"}}]}\r\n\r\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"listOrders","arguments":"{"}}]}}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]},"finish_reason":"tool_calls"}]}\n\nevent: usage\ndata: {"status":"unknown","totalTokens":0,"promptTokens":0,"completionTokens":0}\n\ndata: [DONE]\n\n';
        const bytes = new TextEncoder().encode(data);
        const stream = new ReadableStream({
            start(controller) {
                for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
                controller.close();
            },
        });
        const text: string[] = [];
        const result = await consumeAiStream(new Response(stream), part => text.push(part));
        expect(result.content).toBe("成品库存");
        expect(result.toolCalls).toEqual([
            { id: "call_1", type: "function", function: { name: "listOrders", arguments: "{}" } },
        ]);
        expect(result.usage?.status).toBe("unknown");
        expect(text.at(-1)).toBe("成品库存");
    });
    it("把服务端错误事件显示为失败，而非成功空回答", async () => {
        await expect(
            consumeAiStream(new Response('event: error\ndata: {"message":"上游断流"}\n\n'), () => {}),
        ).rejects.toThrow("上游断流");
    });
    it("缺失 DONE 不能算完成", async () => {
        await expect(
            consumeAiStream(new Response('data: {"choices":[{"delta":{"content":"部分回答"}}]}\n\n'), () => {}),
        ).rejects.toThrow("提前中断");
    });
});
