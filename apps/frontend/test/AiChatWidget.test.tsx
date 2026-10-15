// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AiChatWidget from "@/components/ai/AiChatWidget";
import { runChatAgent } from "@/components/ai/agent";

vi.mock("@/api/ai", () => ({
    fetchAiStatus: vi.fn().mockResolvedValue({ enabled: true, configured: true, model: "test-model" }),
}));
vi.mock("@/api/ai-chat", () => ({ fetchAiDocs: vi.fn().mockResolvedValue({ root: "业务说明", topics: [] }) }));
vi.mock("@/components/ai/agent", () => ({ CHAT_LIMITS: { messageMaxChars: 16_000 }, runChatAgent: vi.fn() }));
vi.mock("@/context/useApp", () => ({
    useApp: () => ({
        user: { name: "测试员工", account: "staff" },
        role: "staff",
        grant: { version: 1, menus: ["workbench"], actions: {} },
        can: () => false,
    }),
}));

beforeEach(() => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    sessionStorage.clear();
    vi.mocked(runChatAgent).mockReset();
    window.matchMedia = vi
        .fn()
        .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

async function openChat() {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <AiChatWidget />
            </MemoryRouter>
        </QueryClientProvider>,
    );
    await user.click(screen.getByRole("button", { name: "打开众茂AI" }));
    await screen.findByText("test-model");
    return user;
}

describe("AI 聊天面板", () => {
    it.each(["回车", "发送按钮", "快捷提问"])("HTTP 环境缺少 randomUUID 时仍可通过%s发送", async method => {
        vi.mocked(runChatAgent).mockResolvedValue("发送成功");
        const user = await openChat();
        const question = method === "快捷提问" ? "今天的成品入库情况" : "查询今天的入库";
        if (method === "快捷提问") {
            await user.click(screen.getByRole("button", { name: question }));
        } else {
            await user.type(screen.getByRole("textbox", { name: "消息内容" }), question);
            if (method === "回车") await user.keyboard("{Enter}");
            else await user.click(screen.getByRole("button", { name: "发送消息" }));
        }
        expect(await screen.findByText("发送成功")).toBeInTheDocument();
        expect(runChatAgent).toHaveBeenCalledTimes(1);
        expect(vi.mocked(runChatAgent).mock.calls[0]![0].history).toEqual([
            expect.objectContaining({ role: "user", content: question }),
        ]);
    });

    it("刷新后恢复附件消息与失败回答时不会产生空正文或把失败当成功", async () => {
        sessionStorage.setItem(
            "zm-ai-chat:staff:staff:1",
            JSON.stringify([
                { role: "user", content: "", state: "complete" },
                { role: "assistant", content: "未完成的回答", state: "error" },
            ]),
        );
        vi.mocked(runChatAgent).mockResolvedValue("新回答");
        const user = await openChat();
        expect(screen.getByText("此前发送了附件，刷新后请重新添加附件。")).toBeInTheDocument();
        expect(screen.getByText("已停止生成")).toBeInTheDocument();
        await user.type(screen.getByRole("textbox", { name: "消息内容" }), "新问题");
        await user.click(screen.getByRole("button", { name: "发送消息" }));
        await screen.findByText("新回答");
        expect(vi.mocked(runChatAgent).mock.calls[0]![0].history[1]!.state).toBe("stopped");
    });
    it("关闭面板后继续回答，完成时显示未读，重新打开清除未读", async () => {
        const pending = Promise.withResolvers<string>();
        vi.mocked(runChatAgent).mockImplementation(async options => {
            options.onText("正在查询");
            return pending.promise;
        });
        const user = await openChat();
        await user.type(screen.getByRole("textbox", { name: "消息内容" }), "当前库存");
        await user.click(screen.getByRole("button", { name: "发送消息" }));
        await screen.findByText("正在查询");
        await user.click(screen.getByRole("button", { name: "收起聊天面板" }));
        await act(async () => {
            pending.resolve("库存 100 件");
        });
        await user.click(await screen.findByRole("button", { name: "打开众茂AI，有新回答" }));
        expect(screen.getByText("库存 100 件")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "收起众茂AI" })).toBeInTheDocument();
    });

    it("停止生成会中止查询，之后可显式重新回答", async () => {
        vi.mocked(runChatAgent)
            .mockImplementationOnce(
                options =>
                    new Promise((_, reject) => {
                        options.signal.addEventListener(
                            "abort",
                            () => reject(new DOMException("stopped", "AbortError")),
                            { once: true },
                        );
                    }),
            )
            .mockResolvedValueOnce("重新查询成功");
        const user = await openChat();
        await user.type(screen.getByRole("textbox", { name: "消息内容" }), "今天入库");
        await user.click(screen.getByRole("button", { name: "发送消息" }));
        await waitFor(() => expect(runChatAgent).toHaveBeenCalledTimes(1));
        await user.click(screen.getByRole("button", { name: "停止生成" }));
        await user.click(await screen.findByRole("button", { name: "重新回答" }));
        expect(await screen.findByText("重新查询成功")).toBeInTheDocument();
        expect(runChatAgent).toHaveBeenCalledTimes(2);
    });

    it("清空进行中的对话后，迟到的回答不会回写", async () => {
        const pending = Promise.withResolvers<string>();
        vi.mocked(runChatAgent).mockReturnValue(pending.promise);
        const user = await openChat();
        await user.type(screen.getByRole("textbox", { name: "消息内容" }), "旧问题");
        await user.click(screen.getByRole("button", { name: "发送消息" }));
        await waitFor(() => expect(runChatAgent).toHaveBeenCalledTimes(1));
        await user.click(screen.getByRole("button", { name: "清空对话" }));
        const dialog = screen.getByRole("dialog", { name: "清空对话" });
        await user.click(within(dialog).getByRole("button", { name: "清空对话" }));
        await act(async () => {
            pending.resolve("迟到的旧回答");
        });
        expect(screen.queryByText("迟到的旧回答")).not.toBeInTheDocument();
        expect(screen.queryByText("旧问题")).not.toBeInTheDocument();
    });

    it("中文输入法确认文字时不误发送，查询结果可打开来源", async () => {
        vi.mocked(runChatAgent).mockImplementation(async options => {
            options.onSource({
                id: "source",
                title: "销售订单",
                queriedAt: "2026-10-15T01:00:00Z",
                filters: {},
                data: [{ orderNo: "ORDER_A", qty: 100 }],
            });
            return "查询成功";
        });
        const user = await openChat();
        const input = screen.getByRole("textbox", { name: "消息内容" });
        await user.type(input, "订单");
        fireEvent.keyDown(input, { key: "Enter", keyCode: 229, isComposing: true });
        expect(runChatAgent).not.toHaveBeenCalled();
        await user.click(screen.getByRole("button", { name: "发送消息" }));
        await user.click(await screen.findByRole("button", { name: "查看销售订单" }));
        expect(screen.getByRole("dialog", { name: "销售订单 · 来源记录" })).toBeInTheDocument();
        expect(screen.getByRole("cell", { name: "ORDER_A" })).toBeInTheDocument();
    });
});
