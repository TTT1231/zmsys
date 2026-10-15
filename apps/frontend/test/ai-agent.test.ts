import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { availableTools, buildHistory, runChatAgent } from "@/components/ai/agent";
import { fetchAiQuery, streamAiChat } from "@/api/ai-chat";

vi.mock("@/api/ai-chat", () => ({ fetchAiQuery: vi.fn(), streamAiChat: vi.fn() }));
const stream = vi.mocked(streamAiChat);
const query = vi.mocked(fetchAiQuery);
const base = () => ({
    root: "系统业务说明",
    history: [{ id: "user", role: "user" as const, content: "查订单" }],
    identity: "员工",
    can: () => true,
    signal: new AbortController().signal,
    onText: vi.fn(),
    onProgress: vi.fn(),
    onSource: vi.fn(),
});
const call = (name = "listOrders", args = "{}") => ({
    content: "",
    finishReason: "tool_calls",
    toolCalls: [{ id: "call_1", type: "function" as const, function: { name, arguments: args } }],
});

beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
});
afterEach(() => vi.unstubAllGlobals());

describe("AI 只读查询编排", () => {
    it("无业务权限时只有文档工具，关系查询须同时具备两个菜单权限", () => {
        expect(availableTools(() => false).map(entry => entry.tool.function.name)).toEqual(["getAiAgentDocTopic"]);
        expect(
            availableTools(code => code === "menu:analytics").some(entry => entry.path === "/workbench/relations"),
        ).toBe(false);
        expect(
            availableTools(code => code === "menu:analytics" || code === "menu:workbench").some(
                entry => entry.path === "/workbench/relations",
            ),
        ).toBe(true);
        expect(
            availableTools(() => true).every(
                entry => !entry.path.includes("/delete") || entry.path === "/ai/agent/deleted",
            ),
        ).toBe(true);
    });
    it("查询使用登录客户端，返回工具结果后继续回答并保存来源", async () => {
        stream
            .mockResolvedValueOnce(call())
            .mockResolvedValueOnce({ content: "订单共一条", toolCalls: [], finishReason: "stop" });
        query.mockResolvedValue([{ orderNo: "ORDER_A", qty: 10 }]);
        const options = base();
        expect(await runChatAgent(options)).toBe("订单共一条");
        expect(query).toHaveBeenCalledWith("/orders", options.signal);
        expect(options.onSource).toHaveBeenCalledWith(
            expect.objectContaining({ title: "销售订单", data: [{ orderNo: "ORDER_A", qty: 10 }] }),
        );
        expect(stream.mock.calls[1]![0].at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_1" });
    });
    it("未知工具或私自拼接参数不会执行接口", async () => {
        stream
            .mockResolvedValueOnce(call("deleteOrder"))
            .mockResolvedValueOnce({ content: "不能执行", toolCalls: [], finishReason: "stop" });
        await runChatAgent(base());
        expect(query).not.toHaveBeenCalled();
        stream
            .mockResolvedValueOnce(call("listAiVoidedOutbound", '{"page":2}'))
            .mockResolvedValueOnce({ content: "不能续页", toolCalls: [], finishReason: "stop" });
        await runChatAgent(base());
        expect(query).not.toHaveBeenCalled();
    });
    it("结果过大时明确告诉模型截断，来源仍保留完整数据", async () => {
        stream
            .mockResolvedValueOnce(call())
            .mockResolvedValueOnce({ content: "结果不完整", toolCalls: [], finishReason: "stop" });
        query.mockResolvedValue([{ remark: "数据".repeat(10_000) }]);
        const options = base();
        await runChatAgent(options);
        const output = JSON.parse(stream.mock.calls[1]![0].at(-1)!.content as string);
        expect(output.truncated).toBe(true);
        expect(output.preview.length).toBeLessThanOrEqual(12_000);
        expect(options.onSource).toHaveBeenCalledWith(
            expect.objectContaining({ data: [{ remark: "数据".repeat(10_000) }] }),
        );
    });
    it("停止后不会继续下一次模型请求", async () => {
        const controller = new AbortController();
        stream.mockResolvedValueOnce(call());
        query.mockImplementation(async () => {
            controller.abort();
            return [];
        });
        await expect(runChatAgent({ ...base(), signal: controller.signal })).rejects.toBeDefined();
        expect(stream).toHaveBeenCalledTimes(1);
    });
    it("文本和图片附件进入实际请求，过长文本被拒绝", () => {
        const history = [
            {
                id: "1",
                role: "user" as const,
                content: "核对",
                attachments: [
                    {
                        id: "a",
                        kind: "image" as const,
                        name: "单据.jpg",
                        size: 1,
                        content: "data:image/jpeg;base64,YWJj",
                    },
                ],
            },
        ];
        expect(buildHistory("说明", history, "用户").at(-1)?.content).toEqual([
            { type: "text", text: "核对" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,YWJj" } },
        ]);
        expect(() => buildHistory("说明", [{ id: "1", role: "user", content: "字".repeat(16_001) }], "用户")).toThrow(
            "16000",
        );
    });
    it("仅附件消息在追问时仍是有效消息，并保留近期图片上下文", () => {
        const messages = buildHistory(
            "说明",
            [
                {
                    id: "photo",
                    role: "user",
                    content: "",
                    attachments: [
                        { id: "a", kind: "image", name: "单据.jpg", size: 1, content: "data:image/jpeg;base64,YWJj" },
                    ],
                },
                { id: "answer", role: "assistant", content: "已查看单据", state: "complete" },
                { id: "followup", role: "user", content: "继续核对数量" },
            ],
            "用户",
        );
        expect(messages[1]!.content).toEqual([
            { type: "text", text: "请查看这些图片。" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,YWJj" } },
        ]);
        expect(messages.at(-1)?.content).toBe("继续核对数量");
    });
});
