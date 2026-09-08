import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/lib/icons";

interface ToastItem {
  id: number;
  message: string;
  error: boolean;
}

const ToastContext = createContext<(message: string, error?: boolean) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((message: string, error?: boolean) => {
    seq.current += 1;
    const id = seq.current;
    const isError = error ?? /请|未找到|超过|必须|失败|不能/.test(message);
    setItems((prev) => [...prev, { id, message, error: isError }]);
    setTimeout(() => setItems((prev) => prev.filter((item) => item.id !== id)), 2400);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-8 z-[220] flex flex-col items-center gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={`pointer-events-auto flex items-center gap-2 rounded-[10px] px-4 py-2.5 text-[13px] text-white shadow-modal ${
              item.error ? "bg-danger" : "bg-sidebar-soft"
            }`}
          >
            <Icon name="check" size={16} className="shrink-0" />
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
