import { useEffect, useRef, useState } from "react";
import { Loader } from "./Loader";

interface LoadingOverlayProps {
    label?: string;
}

/* 数据保留式刷新遮罩:盖住父容器(父级需 relative),旧数据半透明模糊仍可读。
   显示与否由调用方经 useDelayedFlag 防闪烁后条件渲染 */
export function LoadingOverlay({ label = "刷新中…" }: LoadingOverlayProps) {
    return (
        <div
            role="status"
            aria-live="polite"
            className="absolute inset-0 z-10 grid animate-fade-in place-items-center bg-white/60 backdrop-blur-[2px]"
        >
            <span className="flex items-center gap-2.5 text-13 text-muted">
                <Loader size={16} /> {label}
            </span>
        </div>
    );
}

/** 防闪烁标志(仿 vben content-spinner 参数):value 持续 showDelay 后才输出 true,
 *  快速完成(如 <200ms 的请求)全程不显示;一旦显示至少保持 minShow 再消失 */
export function useDelayedFlag(
    value: boolean,
    { showDelay = 200, minShow = 500 }: { showDelay?: number; minShow?: number } = {},
): boolean {
    const [shown, setShown] = useState(false);
    const showTimer = useRef<number | undefined>(undefined);
    const hideTimer = useRef<number | undefined>(undefined);
    const shownAt = useRef(0);

    useEffect(() => {
        if (value) {
            window.clearTimeout(hideTimer.current);
            if (shown) return;
            showTimer.current = window.setTimeout(() => {
                shownAt.current = Date.now();
                setShown(true);
            }, showDelay);
        } else {
            window.clearTimeout(showTimer.current);
            if (!shown) return;
            const remain = Math.max(0, minShow - (Date.now() - shownAt.current));
            hideTimer.current = window.setTimeout(() => setShown(false), remain);
        }
    }, [value, shown, showDelay, minShow]);

    useEffect(
        () => () => {
            window.clearTimeout(showTimer.current);
            window.clearTimeout(hideTimer.current);
        },
        [],
    );

    return shown;
}
