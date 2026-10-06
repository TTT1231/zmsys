import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/lib/icons";
import { Button } from "./Button";

/* 弹窗叠加：栈记录打开顺序，只有栈顶响应 ESC/Tab 并在关闭时解锁滚动、恢复焦点；
   非栈顶层挂 inert（阻焦点/指针并移出无障碍树），栈变化时同步各层 */
const modalStack: symbol[] = [];
let bodyScrollStyle: Pick<CSSStyleDeclaration, "overflow" | "paddingRight"> | null = null;
const stackOverlays = new Map<symbol, HTMLElement>();
const syncStackTop = () => {
    const top = modalStack.at(-1);
    for (const [token, element] of stackOverlays) {
        if (token === top) element.removeAttribute("inert");
        else element.setAttribute("inert", "");
    }
};

interface ModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    /** 标题旁的附加内容（如复制按钮）；不影响 aria-label，仍取 title */
    titleExtra?: ReactNode;
    subtitle?: string;
    label?: string;
    width?: number;
    children: ReactNode;
    footer?: ReactNode;
    layout?: "default" | "workspace" | "detail";
}

export function Modal({
    open,
    onClose,
    title,
    titleExtra,
    subtitle,
    label = "",
    width = 560,
    children,
    footer,
    layout = "default",
}: ModalProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const restoreRef = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!open) return;
        restoreRef.current = document.activeElement as HTMLElement;
        const token = Symbol();
        modalStack.push(token);
        if (overlayRef.current) stackOverlays.set(token, overlayRef.current);
        // 栈从空变非空才锁滚动，叠加时关掉内层不提前解锁外层的锁定
        if (modalStack.length === 1) {
            const body = document.body;
            bodyScrollStyle = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
            const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
            // 仅补偿实际存在的页面滚动条；表格内滚动和 overlay 滚动条不产生额外留白。
            if (scrollbarWidth > 0) {
                const paddingRight = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
                body.style.paddingRight = `${paddingRight + scrollbarWidth}px`;
            }
            body.style.overflow = "hidden";
        }
        syncStackTop();
        const getFocusables = () =>
            Array.from(
                panelRef.current?.querySelectorAll<HTMLElement>(
                    'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[href],[tabindex]:not([tabindex="-1"])',
                ) ?? [],
            ).filter(element => element.getAttribute("aria-hidden") !== "true");

        const focusables = getFocusables();
        (focusables[0] ?? panelRef.current)?.focus();
        const onKey = (event: KeyboardEvent) => {
            // 叠加时只让栈顶响应，避免一次 ESC 关掉多层、焦点陷阱互相拉扯
            if (modalStack.at(-1) !== token) return;
            if (event.key === "Escape") {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
            if (event.key === "Tab" && panelRef.current) {
                const focusables = getFocusables();
                if (focusables.length === 0) {
                    event.preventDefault();
                    panelRef.current.focus();
                    return;
                }
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                if (!panelRef.current.contains(document.activeElement)) {
                    event.preventDefault();
                    (event.shiftKey ? last : first).focus();
                } else if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            const wasTop = modalStack.at(-1) === token;
            modalStack.splice(modalStack.indexOf(token), 1);
            stackOverlays.delete(token);
            syncStackTop();
            if (modalStack.length === 0 && bodyScrollStyle) {
                Object.assign(document.body.style, bodyScrollStyle);
                bodyScrollStyle = null;
            }
            // 仅栈顶正常关闭时恢复焦点；外层先于内层卸载时不与内层抢焦点
            if (wasTop) restoreRef.current?.focus?.();
        };
    }, [open]);

    if (!open) return null;

    /* Portal 到 body:祖先的 transform / backdrop-filter（顶栏毛玻璃、侧栏抽屉）会劫持
       fixed 定位基准,弹窗会被压进祖先盒子;挂 body 才保证遮罩铺满视口 */
    return createPortal(
        <div
            ref={overlayRef}
            className={`fixed inset-0 z-150 flex animate-fade-in bg-scrim backdrop-blur-[2px] ${layout === "detail" ? "items-stretch justify-end" : "items-center justify-center p-4 max-md:items-end max-md:p-0"}`}
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                tabIndex={-1}
                style={{ maxWidth: width }}
                className={`flex w-full flex-col overflow-hidden bg-surface shadow-modal ${
                    layout === "detail" ? "animate-modal-enter-detail" : "animate-modal-enter"
                } ${
                    layout === "detail"
                        ? "h-dvh max-h-dvh rounded-l-panel max-md:rounded-none"
                        : layout === "workspace"
                          ? "h-[calc(100dvh-24px)] max-h-240 rounded-panel max-md:h-[calc(100dvh-16px)] max-md:max-h-[calc(100dvh-16px)] max-md:rounded-b-none max-md:rounded-t-[22px]"
                          : "max-h-[88dvh] rounded-panel max-md:max-h-[calc(100dvh-16px)] max-md:rounded-b-none max-md:rounded-t-[22px]"
                }`}
            >
                <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
                    <div>
                        <div className="text-12 font-semibold tracking-[0.08em] text-primary-strong" hidden={!label}>
                            {label}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <h2 className="text-17 font-semibold text-ink">{title}</h2>
                            {titleExtra}
                        </div>
                        {subtitle && <p className="mt-0.5 text-13 text-muted">{subtitle}</p>}
                    </div>
                    <Button iconOnly onClick={onClose} aria-label="关闭" className="rounded-lg">
                        <Icon name="close" size={18} />
                    </Button>
                </div>
                <div
                    className={`modal-body min-h-0 flex-1 px-6 py-4 ${layout === "workspace" ? "overflow-y-auto lg:flex lg:flex-col lg:overflow-hidden" : "overflow-y-auto"}`}
                >
                    {children}
                </div>
                {footer && (
                    <div className="modal-footer flex flex-wrap justify-end gap-2 border-t border-line bg-panel px-6 py-3.5">
                        {footer}
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}
