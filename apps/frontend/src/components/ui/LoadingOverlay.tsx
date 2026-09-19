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
            className="absolute inset-0 z-10 grid animate-fade-in place-items-center bg-surface/60 backdrop-blur-[2px]"
        >
            <span className="flex items-center gap-2.5 text-13 text-muted">
                <Loader size={16} /> {label}
            </span>
        </div>
    );
}
