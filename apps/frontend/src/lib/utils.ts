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
