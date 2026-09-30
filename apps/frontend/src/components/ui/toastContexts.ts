import { createContext, useContext } from "react";

/* Toast 的 context 与 hooks 单独成文件,避免与 ToastProvider 混导出破坏 React Fast Refresh */

export type Tone = "success" | "error";

/** 操作结果轻提示：tone 由调用点显式选择（不从文案推断，成功文案可含「请/必须」等字） */
export interface ToastApi {
    success(message: string): void;
    error(message: string): void;
}

interface NotificationOptions {
    title: string;
    message: string;
    tone?: Tone;
    duration?: number;
}

export type NotificationPush = (options: NotificationOptions) => void;

export const MessageContext = createContext<ToastApi>({ success: () => {}, error: () => {} });
export const NotificationContext = createContext<NotificationPush>(() => {});

/** 操作结果：顶部居中的单条轻提示。 */
export function useToast(): ToastApi {
    return useContext(MessageContext);
}

/** 标题 + 说明：右上角的通知提醒。 */
export function useNotification() {
    return useContext(NotificationContext);
}
