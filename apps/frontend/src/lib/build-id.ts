/* 从 index.html 文本解析构建标识（由 vite 插件 inject-app-build-id 注入）；
   兼容 meta 属性任意顺序，缺失/为空返回 null（网关错误页、代理页等异常
   响应自然被判为「无标识」，VersionCheck 跳过本次检测） */
export function extractBuildId(html: string): string | null {
    for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
        if (!/name=["']app-build-id["']/i.test(tag)) continue;
        return tag.match(/content=["']([^"']*)["']/i)?.[1] || null;
    }
    return null;
}
