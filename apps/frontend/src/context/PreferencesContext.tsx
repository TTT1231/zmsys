import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    DEFAULT_PREFERENCES,
    FONT_MAX,
    FONT_MIN,
    PreferencesContext,
    applyPreferences,
    initialPreferences,
    resolveDark,
    savePreferences,
    systemPrefersDark,
    type LayoutMode,
    type Preferences,
    type ThemeMode,
    type ThemePreset,
} from "./usePreferences";

/* 此文件只导出 PreferencesProvider 组件；类型 / 存储 / hook 在 ./usePreferences.ts */

export function PreferencesProvider({ children }: { children: ReactNode }) {
    const [preferences, setPreferences] = useState<Preferences>(initialPreferences);
    const [systemDark, setSystemDark] = useState(systemPrefersDark);
    // ref 是同步真相源：连续多次 update / matchMedia 回调都拿最新值，不依赖重渲染刷新闭包
    const preferencesRef = useRef(preferences);
    preferencesRef.current = preferences;
    const systemDarkRef = useRef(systemDark);
    systemDarkRef.current = systemDark;

    // 挂载时兜底重放一次：模块初始化已应用过，但测试环境重置 DOM / HMR 后需要自愈
    useEffect(() => {
        applyPreferences(preferencesRef.current, systemDark);
    }, []);

    // auto 模式跟随系统明暗：系统切换时同步落 DOM 并驱动重渲染（无 matchMedia 的环境跳过）
    useEffect(() => {
        if (typeof window.matchMedia !== "function") return;
        const query = window.matchMedia("(prefers-color-scheme: dark)");
        const update = (event: MediaQueryListEvent) => {
            applyPreferences(preferencesRef.current, event.matches);
            setSystemDark(event.matches);
        };
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);

    // 更新时先写 DOM 再提交状态：渲染期读取计算样式的图表颜色不会拿到上一帧的主题
    const update = useCallback((patch: Partial<Preferences>) => {
        const next = { ...preferencesRef.current, ...patch };
        preferencesRef.current = next;
        applyPreferences(next, systemDarkRef.current);
        savePreferences(next);
        setPreferences(next);
    }, []);

    const value = useMemo(
        () => ({
            preferences,
            isDark: resolveDark(preferences.themeMode, systemDark),
            setThemeMode: (mode: ThemeMode) => update({ themeMode: mode }),
            setThemePreset: (preset: ThemePreset) => update({ themePreset: preset }),
            setLayout: (mode: LayoutMode) => update({ layout: mode }),
            // 字号在入口处钳制，任意调用方都拿不到越界值；函数式增量取 ref 最新值，同帧连点不丢步
            setFontSize: (size: number | ((prev: number) => number)) => {
                const raw = typeof size === "function" ? size(preferencesRef.current.fontSize) : size;
                update({ fontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(raw))) });
            },
            setColorWeakMode: (enabled: boolean) => update({ colorWeakMode: enabled }),
            setColorGrayMode: (enabled: boolean) => update({ colorGrayMode: enabled }),
            reset: () => update({ ...DEFAULT_PREFERENCES }),
        }),
        [preferences, systemDark, update],
    );

    return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
