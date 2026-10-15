import { afterEach, expect, it, vi } from "vitest";
import { readChatAttachment } from "@/components/ai/attachments";

afterEach(() => vi.unstubAllGlobals());

it("HTTP 环境缺少 randomUUID 时仍可读取文本附件", async () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const attachment = await readChatAttachment(new File(["需要核对的数量"], "订单.txt", { type: "text/plain" }));
    expect(attachment).toMatchObject({ name: "订单.txt", kind: "text", content: "需要核对的数量" });
    expect(attachment.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
});
