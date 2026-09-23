import { createContext, useContext } from "react";

/* 偏好设置（vben 式偏好面板的子集）：主题模式 / 内置主题 / 字号 / 色弱 / 灰色。
   状态存 localStorage，DOM 侧落到 <html> 的 class / data-theme / --app-font-scale 上 */

export type ThemeMode = "light" | "dark" | "auto";
export type ThemePreset = "default" | "green" | "deep-green" | "orange";

/** 布局模式（vben LayoutType 子集）：仅桌面端生效，移动端固定抽屉导航 */
export type LayoutMode =
    | "sidebar-nav"
    | "sidebar-mixed-nav"
    | "header-nav"
    | "header-sidebar-nav"
    | "mixed-nav"
    | "header-mixed-nav";

export const LAYOUT_MODES: readonly LayoutMode[] = [
    "sidebar-nav",
    "sidebar-mixed-nav",
    "header-nav",
    "header-sidebar-nav",
    "mixed-nav",
    "header-mixed-nav",
];

export interface Preferences {
    /** 浅色 / 深色 / 跟随系统 */
    themeMode: ThemeMode;
    /** 内置主题：切换 --color-primary 系列设计令牌 */
    themePreset: ThemePreset;
    /** 布局模式：垂直 / 双列菜单 / 水平 / 侧边导航 / 混合垂直 / 混合双列 */
    layout: LayoutMode;
    /** 全局根字号 px（设计基准 16px，12–18） */
    fontSize: number;
    /** 色弱模式（html.invert-mode 滤镜） */
    colorWeakMode: boolean;
    /** 灰色模式（html.grayscale-mode 滤镜） */
    colorGrayMode: boolean;
}

/** 设计基准字号：页面 rem 间距与 px 字号令牌都以它为 1 倍缩放（对齐 vben 默认 16px） */
export const FONT_BASE = 16;
export const FONT_MIN = 12;
export const FONT_MAX = 18;

export const DEFAULT_PREFERENCES: Preferences = {
    themeMode: "light",
    themePreset: "default",
    layout: "sidebar-nav",
    fontSize: FONT_BASE,
    colorWeakMode: false,
    colorGrayMode: false,
};

const STORAGE_KEY = "zmsys.preferences";
const THEME_MODES: readonly ThemeMode[] = ["light", "dark", "auto"];
const THEME_PRESETS: readonly ThemePreset[] = ["default", "green", "deep-green", "orange"];

function clampFontSize(value: unknown): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) return FONT_BASE;
    return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(parsed)));
}

function loadPreferences(): Preferences {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_PREFERENCES };
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_PREFERENCES };
        const record = parsed as Record<string, unknown>;
        return {
            themeMode: THEME_MODES.includes(record.themeMode as ThemeMode)
                ? (record.themeMode as ThemeMode)
                : DEFAULT_PREFERENCES.themeMode,
            themePreset: THEME_PRESETS.includes(record.themePreset as ThemePreset)
                ? (record.themePreset as ThemePreset)
                : DEFAULT_PREFERENCES.themePreset,
            layout: LAYOUT_MODES.includes(record.layout as LayoutMode)
                ? (record.layout as LayoutMode)
                : DEFAULT_PREFERENCES.layout,
            fontSize: clampFontSize(record.fontSize),
            colorWeakMode: record.colorWeakMode === true,
            colorGrayMode: record.colorGrayMode === true,
        };
    } catch {
        // 存量数据损坏时回退默认值，不让偏好设置阻断启动
        return { ...DEFAULT_PREFERENCES };
    }
}

function savePreferences(preferences: Preferences): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
        // 隐私模式等写入失败时仅本次会话生效
    }
}

export function systemPrefersDark(): boolean {
    // jsdom 等测试环境没有 matchMedia，按浅色处理
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveDark(mode: ThemeMode, systemDark: boolean): boolean {
    return mode === "dark" || (mode === "auto" && systemDark);
}

/** 把偏好落到 <html>：dark 类、data-theme、字号缩放变量、色弱 / 灰色滤镜类 */
export function applyPreferences(preferences: Preferences, systemDark: boolean): void {
    const root = document.documentElement;
    root.classList.toggle("dark", resolveDark(preferences.themeMode, systemDark));
    root.dataset.theme = preferences.themePreset;
    root.style.setProperty("--app-font-scale", String(preferences.fontSize / FONT_BASE));
    root.classList.toggle("invert-mode", preferences.colorWeakMode);
    root.classList.toggle("grayscale-mode", preferences.colorGrayMode);
}

/* 模块加载即应用已存偏好：先于 React 首帧渲染写 <html>，避免暗色 / 大字号进入时闪一下默认样式 */
export const initialPreferences = loadPreferences();
applyPreferences(initialPreferences, systemPrefersDark());

interface PreferencesContextValue {
    preferences: Preferences;
    /** themeMode 解析后的实际明暗（auto 跟随系统） */
    isDark: boolean;
    setThemeMode: (mode: ThemeMode) => void;
    setThemePreset: (preset: ThemePreset) => void;
    setLayout: (mode: LayoutMode) => void;
    /** 支持函数式增量（同一帧连点不丢步），入口处钳制到 12–18 */
    setFontSize: (size: number | ((prev: number) => number)) => void;
    setColorWeakMode: (enabled: boolean) => void;
    setColorGrayMode: (enabled: boolean) => void;
    reset: () => void;
}

export const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function usePreferences(): PreferencesContextValue {
    const value = useContext(PreferencesContext);
    if (!value) throw new Error("usePreferences 必须在 PreferencesProvider 内使用");
    return value;
}

export { savePreferences };
