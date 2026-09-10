import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/lib/icons";

type ToastTone = "success" | "error";

interface ToastOptions {
    title?: string;
    message: string;
    tone?: ToastTone;
    duration?: number;
}

interface ToastItem {
    id: number;
    title?: string;
    message: string;
    tone: ToastTone;
    closing: boolean;
}

interface ToastPush {
    (message: string, error?: boolean): void;
    (options: ToastOptions): void;
}

const DEFAULT_DURATION = 3600;
const EXIT_DURATION = 160;

const ToastContext = createContext<ToastPush>(() => {});

export function useToast() {
    return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<ToastItem[]>([]);
    const seq = useRef(0);
    const autoDismissTimers = useRef(new Map<number, number>());
    const exitTimers = useRef(new Map<number, number>());
    const closingIds = useRef(new Set<number>());

    const dismiss = useCallback((id: number) => {
        if (closingIds.current.has(id)) return;
        closingIds.current.add(id);

        const autoDismissTimer = autoDismissTimers.current.get(id);
        if (autoDismissTimer !== undefined) {
            window.clearTimeout(autoDismissTimer);
            autoDismissTimers.current.delete(id);
        }

        setItems(prev => prev.map(item => (item.id === id ? { ...item, closing: true } : item)));
        const exitTimer = window.setTimeout(() => {
            setItems(prev => prev.filter(item => item.id !== id));
            exitTimers.current.delete(id);
            closingIds.current.delete(id);
        }, EXIT_DURATION);
        exitTimers.current.set(id, exitTimer);
    }, []);

    const push = useCallback<ToastPush>(
        (input: string | ToastOptions, error?: boolean) => {
            const options = typeof input === "string" ? { message: input } : input;
            const inferredError = error ?? /请|未找到|超过|必须|失败|不能/.test(options.message);
            const id = ++seq.current;
            const duration = options.duration ?? DEFAULT_DURATION;

            setItems(prev => [
                ...prev,
                {
                    id,
                    title: options.title,
                    message: options.message,
                    tone: options.tone ?? (inferredError ? "error" : "success"),
                    closing: false,
                },
            ]);

            const timer = window.setTimeout(() => dismiss(id), duration);
            autoDismissTimers.current.set(id, timer);
        },
        [dismiss],
    );

    useEffect(
        () => () => {
            autoDismissTimers.current.forEach(timer => window.clearTimeout(timer));
            exitTimers.current.forEach(timer => window.clearTimeout(timer));
        },
        [],
    );

    return (
        <ToastContext.Provider value={push}>
            {children}
            <div className="pointer-events-none fixed inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-220 flex flex-col items-stretch gap-2 md:inset-x-auto md:top-6 md:right-6 md:w-96">
                {items.map(item => (
                    <div
                        key={item.id}
                        role="status"
                        aria-live={item.tone === "error" ? "assertive" : "polite"}
                        aria-atomic="true"
                        data-state={item.closing ? "closing" : "open"}
                        data-tone={item.tone}
                        className={`pointer-events-auto grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-card border border-line bg-surface p-3 text-left shadow-modal will-change-transform md:p-4 ${
                            item.closing ? "animate-notification-exit" : "animate-notification-enter"
                        }`}
                    >
                        <span
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                                item.tone === "error" ? "bg-danger-soft text-danger" : "bg-success-soft text-success"
                            }`}
                        >
                            <Icon name={item.tone === "error" ? "alert" : "check"} size={18} />
                        </span>

                        <div className="min-w-0 self-center">
                            {item.title && <div className="text-14 font-semibold text-ink">{item.title}</div>}
                            <div
                                className={
                                    item.title
                                        ? "mt-0.5 text-13 leading-5 text-muted"
                                        : "text-13 font-medium leading-5 text-td"
                                }
                            >
                                {item.message}
                            </div>
                        </div>

                        <button
                            type="button"
                            aria-label="关闭通知"
                            onClick={() => dismiss(item.id)}
                            className="-mr-2 -mt-2 flex h-11 w-11 items-center justify-center rounded-btn text-muted transition-colors hover:bg-soft hover:text-ink md:-mr-1 md:-mt-1 md:h-8 md:w-8"
                        >
                            <Icon name="close" size={16} />
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}
