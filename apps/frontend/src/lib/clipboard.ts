/* 复制文本到剪贴板：优先异步 Clipboard API；站点经 http 部署时
   navigator.clipboard 不存在（仅安全上下文可用），降级临时 textarea + execCommand。 */
export async function copyText(text: string): Promise<boolean> {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // 权限被拒等场景继续走降级
        }
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
        copied = document.execCommand("copy");
    } catch {
        copied = false;
    }
    textarea.remove();
    return copied;
}
