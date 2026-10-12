import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/* shadcn 约定的类名合并：条件拼接 + 冲突时后值覆盖前值 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/** 随机字节 → 小写 hex（幂等键等本地随机标识共用；补零保证逐字节两位） */
export function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

/** 刷新页面（wrapper：jsdom 的 location.reload 不可重定义，测试经此打桩） */
export function reloadPage(): void {
    window.location.reload();
}

/** UUID v4：优先 crypto.randomUUID；HTTP 局域网访问（非安全上下文）没有该方法时
 * 降级手工拼装（getRandomValues 在非安全上下文仍可用）。幂等键与「BOM 结构」
 * 草稿 tempId 共用。 */
export function uuid(): string {
    if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant
    const hex = bytesToHex(bytes);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
