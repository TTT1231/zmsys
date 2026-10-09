// @vitest-environment jsdom
/* VersionCheck：构建标识解析（属性顺序无关/缺失/空值）、轮询发现新版本弹强制更新
   遮罩（不可关闭）、点击立即刷新 reload、版本一致与网络失败不打扰、
   触发后跳过后续检测、DEV 环境不启动检测 */
import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractBuildId } from "@/lib/build-id";
import { VersionCheck } from "@/components/VersionCheck";

const { reloadMock } = vi.hoisted(() => ({ reloadMock: vi.fn() }));

/* reloadPage 打桩：jsdom 的 location.reload 是不可重定义的自有属性，只能从模块层 mock */
vi.mock("@/lib/utils", async importOriginal => ({
    ...(await importOriginal<typeof import("@/lib/utils")>()),
    reloadPage: reloadMock,
}));

const POLL_MS = 5 * 60_000;

function setLocalBuildId(content: string) {
    document.head.querySelector('meta[name="app-build-id"]')?.remove();
    const meta = document.createElement("meta");
    meta.name = "app-build-id";
    meta.content = content;
    document.head.appendChild(meta);
}

/* fetch 返回线上 index.html 文本（纯对象 mock，不依赖 Response 实现） */
function mockIndexHtml(html: string) {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(html) }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("DEV", false);
    setLocalBuildId("local-build");
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    // unstubAllGlobals 不覆盖 stubEnv 的值，env 必须单独恢复，否则 DEV 会泄漏给后续测试文件
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    document.head.querySelector('meta[name="app-build-id"]')?.remove();
});

describe("extractBuildId", () => {
    it("parses vite-injected meta (name before content)", () => {
        expect(extractBuildId('<head><meta name="app-build-id" content="abc123"></head>')).toBe("abc123");
    });

    it("parses meta regardless of attribute order", () => {
        expect(extractBuildId('<meta content="xyz789" name="app-build-id">')).toBe("xyz789");
    });

    it("returns null when the meta is absent or empty", () => {
        expect(extractBuildId('<head><meta charset="UTF-8"><title>x</title></head>')).toBeNull();
        expect(extractBuildId('<meta name="app-build-id" content="">')).toBeNull();
    });
});

describe("VersionCheck", () => {
    it("blocks the page with an unclosable overlay once polling detects a new build", async () => {
        mockIndexHtml('<meta name="app-build-id" content="remote-new">');
        render(<VersionCheck />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(POLL_MS);
        });
        expect(screen.getByRole("dialog")).toHaveTextContent("系统已更新");
        expect(screen.getByRole("dialog")).toHaveTextContent("请刷新页面继续使用");
        // 强制更新没有取消入口：唯一按钮就是立即刷新，且自动聚焦可回车触发
        expect(screen.getByRole("button", { name: "立即刷新" })).toHaveFocus();
        expect(screen.queryByRole("button", { name: "取消" })).not.toBeInTheDocument();
    });

    it("reloads the page when the refresh button is clicked", async () => {
        mockIndexHtml('<meta name="app-build-id" content="remote-new">');
        render(<VersionCheck />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(POLL_MS);
        });
        fireEvent.click(screen.getByRole("button", { name: "立即刷新" }));
        expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it("cannot be dismissed via Escape or Tab", async () => {
        mockIndexHtml('<meta name="app-build-id" content="remote-new">');
        render(<VersionCheck />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(POLL_MS);
        });
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("skips subsequent checks once the overlay is up", async () => {
        const fetchMock = mockIndexHtml('<meta name="app-build-id" content="remote-new">');
        render(<VersionCheck />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(POLL_MS);
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(POLL_MS * 2);
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("stays silent when the build matches or the request fails", async () => {
        mockIndexHtml('<meta name="app-build-id" content="local-build">');
        const { rerender } = render(<VersionCheck />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(POLL_MS);
        });
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.reject(new Error("network down"))),
        );
        rerender(<VersionCheck />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(POLL_MS * 2);
        });
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("does not poll in DEV", async () => {
        vi.stubEnv("DEV", true);
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        render(<VersionCheck />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(POLL_MS * 3);
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
