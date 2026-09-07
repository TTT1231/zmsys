import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "../../lib/icons";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  label?: string;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, onClose, title, subtitle, label = "", width = 560, children, footer }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement;
    document.body.style.overflow = "hidden";
    const getFocusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[href],[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");

    const focusables = getFocusables();
    (focusables[0] ?? panelRef.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
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
      document.body.style.overflow = "";
      restoreRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-[rgba(15,23,42,.48)] p-4 backdrop-blur-[2px] max-md:items-end max-md:p-0"
      onMouseDown={(event) => {
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
        className="flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-panel bg-white shadow-modal max-md:max-h-[calc(100dvh-16px)] max-md:rounded-b-none max-md:rounded-t-[22px]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.08em] text-primary" hidden={!label}>{label}</div>
            <h2 className="mt-0.5 text-[17px] font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[12.5px] text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[8px] text-muted transition hover:bg-primary-soft hover:text-primary"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal-body min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && <div className="modal-footer flex justify-end gap-2 border-t border-line bg-[#fcfcfd] px-6 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}
