// @vitest-environment jsdom
/* VersionCheck：构建标识解析（属性顺序无关/缺失/空值）、轮询发现新版本弹窗、
   取消与 ESC 转常驻横幅、版本一致与网络失败不打扰、DEV 环境不启动检测 */
import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractBuildId } from "@/lib/build-id";
import { VersionCheck } from "@/components/VersionCheck";

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
    vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(html) })),
    );
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
    it("prompts a modal after polling detects a new build", async () => {
        mockIndexHtml('<meta name="app-build-id" content="remote-new">');
        render(<VersionCheck />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(POLL_MS);
        });
        expect(screen.getByRole("dialog")).toHaveTextContent("新版本可用");
        expect(screen.getByRole("dialog")).toHaveTextContent("点击刷新以获取最新版本");
        expect(screen.getByRole("button", { name: "刷新" })).toHaveFocus();
    });

    it("keeps a persistent banner after cancelling the modal", async () => {
        mockIndexHtml('<meta name="app-build-id" content="remote-new">');
        render(<VersionCheck />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(POLL_MS);
        });
        fireEvent.click(screen.getByRole("button", { name: "取消" }));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(screen.getByText("新版本可用")).toBeInTheDocument();
        expect(screen.getByText("点击刷新以获取最新版本")).toBeInTheDocument();
    });

    it("cancels via Escape and shows the banner too", async () => {
        mockIndexHtml('<meta name="app-build-id" content="remote-new">');
        render(<VersionCheck />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(POLL_MS);
        });
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(screen.getByText("点击刷新以获取最新版本")).toBeInTheDocument();
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
