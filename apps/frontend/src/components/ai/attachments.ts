import { uuid } from "@/lib/utils";
import type { ChatAttachment } from "./types";

const TEXT_EXTENSIONS = new Set(["txt", "md", "csv", "json"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
export const ATTACHMENT_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.json";

export async function readChatAttachment(file: File): Promise<ChatAttachment> {
    if (file.size > 10 * 1024 * 1024) throw new Error(`「${file.name}」超过 10MB，请选择较小的文件`);
    const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
    const base = { id: uuid(), name: file.name, size: file.size };
    if (TEXT_EXTENSIONS.has(extension)) {
        const content = await file.text();
        if (!content.trim()) throw new Error(`「${file.name}」没有可读取的文字`);
        if (content.length > 12_000) throw new Error(`「${file.name}」文字过多，请截取相关部分（最多 12000 字符）`);
        return { ...base, kind: "text", content };
    }
    if (!IMAGE_EXTENSIONS.has(extension)) throw new Error("支持图片和 txt / md / csv / json 文件");
    const bitmap = await createImageBitmap(file).catch(() => {
        throw new Error(`「${file.name}」无法读取，请检查图片格式`);
    });
    try {
        const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法处理图片，请换一张或使用文字说明");
        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        let content = canvas.toDataURL("image/jpeg", 0.75);
        for (const quality of [0.6, 0.45, 0.3]) {
            if (content.length <= 120_000) break;
            content = canvas.toDataURL("image/jpeg", quality);
        }
        if (content.length > 180_000) throw new Error(`「${file.name}」压缩后仍过大，请裁剪后重试`);
        return { ...base, kind: "image", content };
    } finally {
        bitmap.close();
    }
}
