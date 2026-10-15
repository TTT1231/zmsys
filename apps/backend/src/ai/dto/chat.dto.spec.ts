import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { describe, expect, it } from "vitest";
import { AI_CHAT_LIMITS } from "../ai-docs-topics";
import { ChatRequestDto } from "./chat.dto";

const errors = (messages: unknown[]) => validateSync(plainToInstance(ChatRequestDto, { messages }));

describe("AI 对话输入", () => {
    it("40 条可通过，超过统一常量时拒绝", () => {
        const messages = Array.from({ length: AI_CHAT_LIMITS.maxMessages }, () => ({ role: "user", content: "问题" }));
        expect(errors(messages)).toHaveLength(0);
        expect(errors([...messages, messages[0]])).not.toHaveLength(0);
    });
    it("工具调用与结果可通过；tool 缺少对应 id 时拒绝", () => {
        expect(
            errors([
                {
                    role: "assistant",
                    tool_calls: [{ id: "call_1", type: "function", function: { name: "listOrders", arguments: "{}" } }],
                },
                { role: "tool", tool_call_id: "call_1", content: "[]" },
            ]),
        ).toHaveLength(0);
        expect(errors([{ role: "tool", content: "[]" }])).not.toHaveLength(0);
    });
    it.each([{ role: "user" }, { role: "user", content: "" }, { role: "assistant" }])(
        "拒绝没有有效正文或工具调用的消息：%j",
        message => {
            expect(errors([message])).not.toHaveLength(0);
        },
    );
    it("用户可提交压缩图片；不接受远程图片或超过图片个数限制", () => {
        const image = { type: "image_url", image_url: { url: "data:image/jpeg;base64,YWJj" } };
        expect(errors([{ role: "user", content: [{ type: "text", text: "核对单据" }, image] }])).toHaveLength(0);
        expect(
            errors([{ role: "user", content: [{ ...image, image_url: { url: "https://example.com/image.png" } }] }]),
        ).not.toHaveLength(0);
        expect(errors([{ role: "user", content: Array.from({ length: 6 }, () => image) }])).not.toHaveLength(0);
    });
});
