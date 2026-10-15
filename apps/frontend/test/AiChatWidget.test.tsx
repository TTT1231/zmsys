// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AiChatWidget from "@/components/ai/AiChatWidget";
import { runChatAgent } from "@/components/ai/agent";
import * as utils from "@/lib/utils";

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
    vi.restoreAllMocks();
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
    it("思考和处理步骤可展开，与回答正文分开展示", async () => {
        const pending = Promise.withResolvers<string>();
        vi.mocked(runChatAgent).mockImplementation(options => {
            options.onReasoning?.("正在核对今天的记录");
            options.onProgress("正在查询成品入库…");
            return pending.promise;
        });
        const user = await openChat();
        await user.type(screen.getByRole("textbox", { name: "消息内容" }), "今天入库");
        await user.keyboard("{Enter}");
        await user.click(await screen.findByText("正在思考"));
        expect(screen.getByText("正在核对今天的记录").closest("details")).toHaveAttribute("open");
        expect(screen.getByText("正在查询成品入库…", { selector: "li" })).toBeInTheDocument();
        await act(async () => pending.resolve("今天入库12"));
        expect(await screen.findByText("今天入库12")).toBeInTheDocument();
        expect(screen.getByText("思考过程")).toBeInTheDocument();
    });
    it("轻轻向上翻后继续输出也不会抢回底部", async () => {
        const pending = Promise.withResolvers<string>();
        let onText: ((text: string) => void) | undefined;
        vi.mocked(runChatAgent).mockImplementation(options => {
            onText = options.onText;
            return pending.promise;
        });
        const user = await openChat();
        await user.type(screen.getByRole("textbox", { name: "消息内容" }), "长回答");
        await user.keyboard("{Enter}");
        await waitFor(() => expect(onText).toBeDefined());
        const body = screen.getByRole("region", { name: "对话内容" });
        let height = 2000;
        Object.defineProperties(body, {
            scrollHeight: { configurable: true, get: () => height },
            clientHeight: { configurable: true, value: 500 },
        });
        body.scrollTop = 1500;
        fireEvent.scroll(body);
        fireEvent.wheel(body, { deltaY: -5 });
        body.scrollTop = 1495;
        fireEvent.scroll(body);
        height = 2400;
        await act(async () => onText?.("新增的回答文字"));
        await screen.findByText("新增的回答文字");
        expect(body.scrollTop).toBe(1495);
        expect(screen.getByRole("button", { name: "回到底部" })).toBeInTheDocument();
        await act(async () => pending.resolve("回答完成"));
        expect(body.scrollTop).toBe(1495);
    });
    it.each(["回车", "发送按钮", "快捷提问"])("HTTP 环境缺少 randomUUID 时仍可通过%s发送", async method => {
        vi.mocked(runChatAgent).mockResolvedValue("发送成功");
        const user = await openChat();
        const question = method === "快捷提问" ? "今天成品的出入库情况" : "查询今天的入库";
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

    it("网络或服务请求失败时显示明确提示，点击重试才重新发送原问题", async () => {
        vi.mocked(runChatAgent)
            .mockRejectedValueOnce(new Error("网络连接失败，请检查网络后重试"))
            .mockResolvedValueOnce("重试成功");
        const user = await openChat();
        await user.type(screen.getByRole("textbox", { name: "消息内容" }), "查订单");
        await user.click(screen.getByRole("button", { name: "发送消息" }));
        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("发送失败");
        expect(alert).toHaveTextContent("网络连接失败，请检查网络后重试");
        expect(runChatAgent).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("button", { name: "停止生成" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "重试" }));
        expect(await screen.findByText("重试成功")).toBeInTheDocument();
        expect(runChatAgent).toHaveBeenCalledTimes(2);
        expect(vi.mocked(runChatAgent).mock.calls[1]![0].history.at(-1)).toMatchObject({
            role: "user",
            content: "查订单",
        });
    });

    it("回答途中断线时保留已有文字，并提示回答中断", async () => {
        vi.mocked(runChatAgent).mockImplementation(async options => {
            options.onText("已经收到的部分回答");
            throw new Error("网络连接中断，请检查网络后重试");
        });
        const user = await openChat();
        await user.type(screen.getByRole("textbox", { name: "消息内容" }), "查库存");
        await user.keyboard("{Enter}");
        expect(await screen.findByRole("alert")).toHaveTextContent("回答中断");
        expect(screen.getByText("已经收到的部分回答")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    });

    it("发送前出现异常也会提示失败，并保留尚未发送的输入", async () => {
        const user = await openChat();
        vi.spyOn(utils, "uuid").mockImplementationOnce(() => {
            throw new Error("无法创建消息");
        });
        const input = screen.getByRole("textbox", { name: "消息内容" });
        await user.type(input, "尚未发送的问题");
        await user.keyboard("{Enter}");
        expect(await screen.findByRole("alert")).toHaveTextContent("发送失败：无法创建消息");
        expect(input).toHaveValue("尚未发送的问题");
        expect(runChatAgent).not.toHaveBeenCalled();
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

    it("中文输入法确认文字时不误发送，回答不再显示来源记录按钮", async () => {
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
        expect(await screen.findByText("查询成功")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "查看销售订单" })).not.toBeInTheDocument();
    });
});
