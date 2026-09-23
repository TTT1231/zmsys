import { useEffect } from "react";
import { enterRoutePending, exitRoutePending } from "@/lib/route-pending";
import { Loader } from "./Loader";

interface PageLoadingProps {
    /** 视觉与读屏共用的统一提示文案,默认"加载中…"(全局加载统一表达,不用场景专属文案) */
    label?: string;
    /** 追加类名:全屏场景传 "min-h-dvh bg-canvas" */
    className?: string;
    /** 路由级加载标记(懒加载 chunk 挂起 / 认证校验):上报顶部路由进度条;
        页面内数据占位不传——进度条只属于路由切换,数据加载由占位自身表达(vben 语义) */
    routeLevel?: boolean;
}

/* 替换式页面占位:首载 / 认证校验 / 路由 chunk 加载(Suspense fallback)/ 页面首屏数据。
   routeLevel 的挂载/卸载向 route-pending 计数上报,作为顶部路由进度条的"仍在加载"信号;
   多实例并存时逐一退出,先卸载的不会误清仍挂载实例的信号 */
export function PageLoading({ label = "加载中…", className = "", routeLevel = false }: PageLoadingProps) {
    useEffect(() => {
        if (!routeLevel) return;
        enterRoutePending();
        return () => exitRoutePending();
    }, [routeLevel]);

    return (
        <div
            role="status"
            aria-label={label}
            className={`flex min-h-40 flex-col items-center justify-center gap-3 py-16 text-14 text-muted ${className}`}
        >
            {/* 全局/页面级加载用大尺寸(对齐 vben 48px 量级),与表格内小 loader 分级 */}
            <Loader size={44} />
            <span>{label}</span>
        </div>
    );
}
