import { createContext, useContext, type ReactNode } from "react";
import { Toaster, toast } from "sonner";
import { Icon } from "@/lib/icons";

type Tone = "success" | "error";
type MessagePush = (message: string, error?: boolean) => void;

interface NotificationOptions {
    title: string;
    message: string;
    tone?: Tone;
    duration?: number;
}

type NotificationPush = (options: NotificationOptions) => void;

const MessageContext = createContext<MessagePush>(() => {});
const NotificationContext = createContext<NotificationPush>(() => {});
let activeMessageId: string | number | undefined;

/** 操作结果：顶部居中的单条轻提示。 */
export function useToast() {
    return useContext(MessageContext);
}

/** 标题 + 说明：右上角的通知提醒。 */
export function useNotification() {
    return useContext(NotificationContext);
}

const pushMessage: MessagePush = (message, error) => {
    const tone: Tone = (error ?? /请|未找到|超过|必须|失败|不能/.test(message)) ? "error" : "success";
    const show = tone === "error" ? toast.error : toast.success;
    if (activeMessageId !== undefined) toast.dismiss(activeMessageId);
    activeMessageId = show(message, {
        toasterId: "message",
        duration: message.length > 28 ? 5000 : tone === "error" ? 4000 : 3000,
        closeButton: false,
        onAutoClose: item => {
            if (activeMessageId === item.id) activeMessageId = undefined;
        },
        onDismiss: item => {
            if (activeMessageId === item.id) activeMessageId = undefined;
        },
    });
};

const pushNotification: NotificationPush = ({ title, message, tone = "success", duration = 5000 }) => {
    const show = tone === "error" ? toast.error : toast.success;
    show(title, { toasterId: "notification", description: message, duration, closeButton: true });
};

export function ToastProvider({ children }: { children: ReactNode }) {
    return (
        <MessageContext.Provider value={pushMessage}>
            <NotificationContext.Provider value={pushNotification}>
                {children}
                <Toaster
                    id="message"
                    position="top-center"
                    offset="max(16px, env(safe-area-inset-top))"
                    mobileOffset={{ top: "max(96px, calc(env(safe-area-inset-top) + 80px))", left: 0, right: 0 }}
                    visibleToasts={1}
                    containerAriaLabel="全局提示"
                    closeButton={false}
                    toastOptions={{ unstyled: true, classNames: { toast: "app-message-toast" } }}
                    icons={{ success: <Icon name="check" size={17} />, error: <Icon name="alert" size={17} /> }}
                />
                <Toaster
                    id="notification"
                    position="top-right"
                    offset={{ top: "max(24px, env(safe-area-inset-top))", right: 24 }}
                    mobileOffset={{ top: "max(96px, calc(env(safe-area-inset-top) + 80px))", left: 0, right: 0 }}
                    visibleToasts={3}
                    containerAriaLabel="通知提醒"
                    toastOptions={{
                        unstyled: true,
                        closeButtonAriaLabel: "关闭通知",
                        classNames: { toast: "app-notification-toast" },
                    }}
                    icons={{
                        success: <Icon name="check" size={18} />,
                        error: <Icon name="alert" size={18} />,
                        close: <Icon name="close" size={16} />,
                    }}
                />
            </NotificationContext.Provider>
        </MessageContext.Provider>
    );
}
