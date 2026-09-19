/* ECharts 画在 canvas 上，不识别 CSS 变量 / color-mix：渲染期把主题设计令牌解析成具体颜色。
   依赖 <html> 的主题类 / data-theme 已先于本轮渲染写入（见 PreferencesProvider 的同步 update） */

let probe: HTMLSpanElement | null = null;

/** 读 <html> 上声明的令牌原文（hex / hsl / rgba 均可直接喂给 echarts） */
export function tokenColor(name: string, fallback: string): string {
    if (typeof window === "undefined") return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

/** 借隐藏探针元素把任意 CSS 颜色表达式（含 color-mix / var()）结算成 rgb() 字符串 */
function resolveColor(color: string): string {
    if (typeof window === "undefined" || !document.body) return color;
    probe ??= document.body.appendChild(document.createElement("span"));
    probe.style.color = "";
    probe.style.color = color;
    return getComputedStyle(probe).color || color;
}

/** 令牌归一成 rgb()：预设主题里主色可能是 hsl()，透明度换算只认 rgb()/hex */
function resolveToken(name: string, fallback: string): string {
    const resolved = resolveColor(`var(${name})`);
    return resolved.startsWith("rgb") ? resolved : tokenColor(name, fallback);
}

/** 给 rgb()/rgba()/hex 颜色换透明度（趋势图面积渐变用） */
export function withAlpha(color: string, alpha: number): string {
    const rgbMatch = color.match(/^rgba?\(([^)]+)\)$/i);
    if (rgbMatch) {
        const [r, g, b] = rgbMatch[1].split(",").map(part => Number.parseFloat(part));
        return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)
            ? `rgba(${r}, ${g}, ${b}, ${alpha})`
            : color;
    }
    const hexMatch = color.match(/^#([0-9a-f]{6})$/i);
    if (hexMatch) {
        const [r, g, b] = [0, 2, 4].map(offset => Number.parseInt(hexMatch[1].slice(offset, offset + 2), 16));
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color;
}

export interface ChartPalette {
    muted: string;
    soft: string;
    line: string;
    td: string;
    tdStrong: string;
    primary: string;
    /** 主色向白混合的中坚档（排行条形第二档） */
    primaryMid: string;
    primaryBorder: string;
    warning: string;
}

export function chartPalette(): ChartPalette {
    return {
        muted: tokenColor("--color-muted", "#667085"),
        soft: tokenColor("--color-soft", "#f8fafc"),
        line: tokenColor("--color-line", "#e4e7ec"),
        td: tokenColor("--color-td", "#344054"),
        tdStrong: tokenColor("--color-td-strong", "#475467"),
        primary: resolveToken("--color-primary", "#4f46e5"),
        primaryMid: resolveColor("color-mix(in srgb, var(--color-primary) 45%, white)"),
        primaryBorder: tokenColor("--color-primary-border", "#c7d2fe"),
        warning: tokenColor("--color-warning", "#92400e"),
    };
}
