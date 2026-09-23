// @vitest-environment jsdom
/* 偏好设置：DOM 落点（dark 类 / data-theme / 字号缩放 / 滤镜）、localStorage 持久化、抽屉交互 */
import "@testing-library/jest-dom/vitest";

import { useEffect } from "react";

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PreferencesProvider } from "@/context/PreferencesContext";
import { FONT_BASE, usePreferences } from "@/context/usePreferences";
import { PreferencesDrawer } from "@/components/layout/PreferencesDrawer";

// 每次渲染后刷新为最新的 context value，供直接调用各项 setter
const captured: { current: ReturnType<typeof usePreferences> | null } = { current: null };

function Probe() {
    const prefs = usePreferences();
    useEffect(() => {
        captured.current = prefs;
    });
    return null;
}

function renderApp() {
    render(
        <PreferencesProvider>
            <Probe />
        </PreferencesProvider>,
    );
}

beforeEach(() => {
    localStorage.clear();
    const root = document.documentElement;
    root.className = "";
    delete root.dataset.theme;
    root.style.removeProperty("--app-font-scale");
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("偏好上下文", () => {
    it("默认浅色：无 dark 类，data-theme=default，缩放为 1", () => {
        renderApp();
        const root = document.documentElement;
        expect(root.classList.contains("dark")).toBe(false);
        expect(root.dataset.theme).toBe("default");
        expect(root.style.getPropertyValue("--app-font-scale")).toBe("1");
    });

    it("切深色 / 内置主题落到 html，并写入 localStorage", async () => {
        renderApp();
        act(() => {
            captured.current!.setThemeMode("dark");
            captured.current!.setThemePreset("green");
        });
        expect(document.documentElement.classList.contains("dark")).toBe(true);
        expect(document.documentElement.dataset.theme).toBe("green");
        expect(captured.current!.isDark).toBe(true);
        expect(JSON.parse(localStorage.getItem("zmsys.preferences")!)).toMatchObject({
            themeMode: "dark",
            themePreset: "green",
        });
    });

    it("auto 模式跟随系统深色", () => {
        vi.stubGlobal(
            "matchMedia",
            vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
        );
        renderApp();
        act(() => captured.current!.setThemeMode("auto"));
        expect(document.documentElement.classList.contains("dark")).toBe(true);
        expect(captured.current!.isDark).toBe(true);
    });

    it("字号钳制在 12–18 并换算缩放倍率", () => {
        renderApp();
        act(() => captured.current!.setFontSize(18));
        expect(document.documentElement.style.getPropertyValue("--app-font-scale")).toBe(String(18 / FONT_BASE));
        act(() => captured.current!.setFontSize(99));
        expect(captured.current!.preferences.fontSize).toBe(18);
        act(() => captured.current!.setFontSize(1));
        expect(captured.current!.preferences.fontSize).toBe(12);
    });

    it("色弱 / 灰色模式切换滤镜类", () => {
        renderApp();
        act(() => {
            captured.current!.setColorWeakMode(true);
            captured.current!.setColorGrayMode(true);
        });
        expect(document.documentElement.classList.contains("invert-mode")).toBe(true);
        expect(document.documentElement.classList.contains("grayscale-mode")).toBe(true);
        act(() => captured.current!.setColorWeakMode(false));
        expect(document.documentElement.classList.contains("invert-mode")).toBe(false);
    });

    it("重置回到默认并同步 localStorage", () => {
        renderApp();
        act(() => captured.current!.setThemeMode("dark"));
        act(() => captured.current!.reset());
        expect(document.documentElement.classList.contains("dark")).toBe(false);
        expect(JSON.parse(localStorage.getItem("zmsys.preferences")!)).toMatchObject({
            themeMode: "light",
            fontSize: FONT_BASE,
        });
    });

    it("布局模式经 setLayout 写入偏好与 localStorage，重置回垂直", () => {
        renderApp();
        act(() => captured.current!.setLayout("header-nav"));
        expect(captured.current!.preferences.layout).toBe("header-nav");
        expect(JSON.parse(localStorage.getItem("zmsys.preferences")!)).toMatchObject({ layout: "header-nav" });
        act(() => captured.current!.reset());
        expect(captured.current!.preferences.layout).toBe("sidebar-nav");
    });

    it("持久化的布局模式在模块加载时恢复，坏值回退垂直", async () => {
        localStorage.setItem("zmsys.preferences", JSON.stringify({ layout: "mixed-nav" }));
        vi.resetModules();
        const restored = await import("@/context/usePreferences");
        expect(restored.initialPreferences.layout).toBe("mixed-nav");

        localStorage.setItem("zmsys.preferences", JSON.stringify({ layout: "bogus" }));
        vi.resetModules();
        const fallback = await import("@/context/usePreferences");
        expect(fallback.initialPreferences.layout).toBe("sidebar-nav");
    });

    it("模块加载即恢复已存偏好（先于首帧渲染），坏数据回退默认", async () => {
        localStorage.setItem(
            "zmsys.preferences",
            JSON.stringify({ themeMode: "dark", themePreset: "orange", fontSize: 17, colorGrayMode: true }),
        );
        vi.resetModules();
        await import("@/context/usePreferences");
        const root = document.documentElement;
        expect(root.classList.contains("dark")).toBe(true);
        expect(root.dataset.theme).toBe("orange");
        expect(root.style.getPropertyValue("--app-font-scale")).toBe(String(17 / FONT_BASE));
        expect(root.classList.contains("grayscale-mode")).toBe(true);

        localStorage.setItem("zmsys.preferences", "{oops");
        root.className = "";
        vi.resetModules();
        await import("@/context/usePreferences");
        expect(root.classList.contains("dark")).toBe(false);
        expect(root.dataset.theme).toBe("default");
    });
});

describe("偏好设置抽屉", () => {
    function renderDrawer() {
        render(
            <PreferencesProvider>
                <PreferencesDrawer open onClose={() => {}} />
            </PreferencesProvider>,
        );
    }

    it("未改动时恢复默认禁用，改动后可一键还原", async () => {
        const user = userEvent.setup();
        renderDrawer();
        const reset = screen.getByRole("button", { name: "恢复默认" });
        expect(reset).toBeDisabled();
        await user.click(screen.getByRole("button", { name: /深色/ }));
        expect(document.documentElement.classList.contains("dark")).toBe(true);
        expect(reset).toBeEnabled();
        await user.click(reset);
        expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it("内置主题与色弱开关在抽屉内即时生效", async () => {
        const user = userEvent.setup();
        renderDrawer();
        await user.click(screen.getByRole("button", { name: "浅绿色" }));
        expect(document.documentElement.dataset.theme).toBe("green");
        await user.click(screen.getByRole("switch", { name: "色弱模式" }));
        expect(document.documentElement.classList.contains("invert-mode")).toBe(true);
    });

    it("外观/布局分段 tab：默认外观，切布局后六选项可点并写入偏好", async () => {
        const user = userEvent.setup();
        renderDrawer();
        // 默认外观 tab：布局选项不渲染
        expect(screen.queryByRole("button", { name: "混合双列" })).toBeNull();
        await user.click(screen.getByRole("tab", { name: "布局" }));
        for (const label of ["垂直", "双列菜单", "水平", "侧边导航", "混合垂直", "混合双列"]) {
            expect(screen.getByRole("button", { name: label })).toBeVisible();
        }
        await user.click(screen.getByRole("button", { name: "水平" }));
        expect(JSON.parse(localStorage.getItem("zmsys.preferences")!)).toMatchObject({ layout: "header-nav" });
        await user.click(screen.getByRole("tab", { name: "外观" }));
        expect(screen.queryByRole("button", { name: "混合双列" })).toBeNull();
    });

    it("字号步进按钮在边界处禁用", async () => {
        const user = userEvent.setup();
        renderDrawer();
        const minus = screen.getByRole("button", { name: "减小字号" });
        const plus = screen.getByRole("button", { name: "增大字号" });
        await user.click(plus);
        expect(screen.getByLabelText("字体大小")).toHaveValue(String(FONT_BASE + 1));
        for (let i = 0; i < 10; i++) await user.click(plus);
        expect(plus).toBeDisabled();
        for (let i = 0; i < 10; i++) await user.click(minus);
        expect(minus).toBeDisabled();
        expect(screen.getByLabelText("字体大小")).toHaveValue("12");
    });

    it("同一帧内连续步进不丢步（函数式增量）", () => {
        renderApp();
        const { setFontSize } = captured.current!;
        act(() => {
            // 向下步进避免撞上 18 的钳制上限，干扰“不丢步”断言
            setFontSize(prev => prev - 1);
            setFontSize(prev => prev - 1);
            setFontSize(prev => prev - 1);
        });
        expect(captured.current!.preferences.fontSize).toBe(FONT_BASE - 3);
        expect(document.documentElement.style.getPropertyValue("--app-font-scale")).toBe(
            String((FONT_BASE - 3) / FONT_BASE),
        );
    });
});
