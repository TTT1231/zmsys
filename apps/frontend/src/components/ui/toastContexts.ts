import { createContext, useContext } from "react";

/* Toast 的 context 与 hooks 单独成文件,避免与 ToastProvider 混导出破坏 React Fast Refresh */

export type Tone = "success" | "error";
export type MessagePush = (message: string, error?: boolean) => void;

interface NotificationOptions {
    title: string;
    message: string;
    tone?: Tone;
    duration?: number;
}

export type NotificationPush = (options: NotificationOptions) => void;

export const MessageContext = createContext<MessagePush>(() => {});
export const NotificationContext = createContext<NotificationPush>(() => {});

/** 操作结果：顶部居中的单条轻提示。 */
export function useToast() {
    return useContext(MessageContext);
}

/** 标题 + 说明：右上角的通知提醒。 */
export function useNotification() {
    return useContext(NotificationContext);
}
