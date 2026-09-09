import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/* shadcn 约定的类名合并：条件拼接 + 冲突时后值覆盖前值 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
