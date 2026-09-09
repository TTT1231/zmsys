import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { isRoutePending } from "@/lib/route-pending";

type Phase = "idle" | "active" | "finishing";

/** 同步导航最小展示时长:路径瞬时切换时进度条不至于一闪而过 */
const MIN_ACTIVE_MS = 300;
/** 收尾淡出时长,与内条 transition-duration 对齐 */
const FINISH_MS = 220;

/* 顶部路由进度条(仿 vben/nprogress 交互):挂载(硬刷新/进入)与 pathname 变化时启动;
   结束条件 = route-pending 归零(懒加载 chunk / 认证校验完成),再补足最小展示。
   必须挂在路由树内(经 ProgressLayout),useLocation 是唯一可靠的导航信号 */
export function RouteProgressBar() {
    const { pathname } = useLocation();
    const [phase, setPhase] = useState<Phase>("idle");
    const [width, setWidth] = useState(0);
    const phaseRef = useRef<Phase>("idle");
    const startedAt = useRef(0);
    const finishTimer = useRef<number | undefined>(undefined);

    const applyPhase = (next: Phase) => {
        phaseRef.current = next;
        setPhase(next);
    };

    const start = () => {
        window.clearTimeout(finishTimer.current);
        startedAt.current = Date.now();
        if (phaseRef.current === "idle") setWidth(8);
        else if (phaseRef.current === "finishing") setWidth(25);
        applyPhase("active");
    };

    useEffect(() => {
        start();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

    /* active 期:渐近推进;满足结束条件后满格淡出 */
    useEffect(() => {
        if (phase !== "active") return;
        const iv = window.setInterval(() => {
            if (!isRoutePending() && Date.now() - startedAt.current >= MIN_ACTIVE_MS) {
                window.clearInterval(iv);
                setWidth(100);
                applyPhase("finishing");
                finishTimer.current = window.setTimeout(() => {
                    setWidth(0);
                    applyPhase("idle");
                }, FINISH_MS);
                return;
            }
            setWidth(prev => prev + (88 - prev) * 0.22);
        }, 140);
        return () => window.clearInterval(iv);
    }, [phase]);

    return (
        <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-60 h-0.5">
            <div
                className={`h-full bg-primary transition-[width,opacity] duration-200 ease-out ${
                    phase === "active" ? "opacity-100" : "opacity-0"
                }`}
                style={{ width: `${width}%` }}
            />
        </div>
    );
}

/* 根布局:进度条置于所有路由之上(login ↔ 应用互切同样覆盖) */
export function ProgressLayout() {
    return (
        <>
            <RouteProgressBar />
            <Outlet />
        </>
    );
}
