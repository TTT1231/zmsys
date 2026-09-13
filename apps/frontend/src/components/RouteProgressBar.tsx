import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router";
import { isRoutePending, subscribeRoutePending } from "@/lib/route-pending";

type Phase = "idle" | "active" | "finishing";

/* 加载期宽度爬升:超长 CSS 过渡逼近 88%,复刻 nprogress trickle 的前快后慢,无需 JS 计时 */
const CREEP_TRANSITION = "transition-[width] duration-[10000ms] ease-[cubic-bezier(0.1,0.35,0.25,1)]";
/* 归零冲刺:信号结束即快速滑向 100%(对齐 vben 的 speed: 300 量级) */
const SETTLE_TRANSITION = "transition-[width] duration-200 ease-out";
/* 满格淡出:width 定格,opacity 退场 */
const FADE_TRANSITION = "transition-opacity duration-300 ease-out";
/** 满格停留时长,之后开始淡出 */
const HOLD_MS = 300;
/** 淡出时长,完成后 width 静默归零 */
const FADE_MS = 300;

/* 顶部路由进度条(借鉴 vben/nprogress 的事件对模型):route-pending 出现路由级加载
   (懒加载 chunk / 认证校验)即显示,归零即满格淡出,全程由订阅事件驱动;
   宽度推进交给 CSS 过渡,无轮询、无最小展示时长——缓存命中的瞬时切换不出现进度条,
   页面数据加载由页面内占位表达,不进这条链路 */
export function RouteProgressBar() {
    const [phase, setPhase] = useState<Phase>("idle");
    const [width, setWidth] = useState(0);
    const phaseRef = useRef<Phase>("idle");
    const hideTimer = useRef<number | undefined>(undefined);
    const resetTimer = useRef<number | undefined>(undefined);

    useEffect(() => {
        const show = () => {
            window.clearTimeout(hideTimer.current);
            window.clearTimeout(resetTimer.current);
            // 淡出中途新加载开始时不倒退,从当前值继续爬
            setWidth(prev => Math.max(88, prev));
            phaseRef.current = "active";
            setPhase("active");
        };
        const settle = () => {
            setWidth(100);
            phaseRef.current = "finishing";
            setPhase("finishing");
            hideTimer.current = window.setTimeout(() => {
                phaseRef.current = "idle";
                setPhase("idle");
                // 淡出完成后归零,下一轮从 0 重新爬升(此刻 opacity 已为 0,不可见)
                resetTimer.current = window.setTimeout(() => setWidth(0), FADE_MS);
            }, HOLD_MS);
        };
        const sync = () => {
            if (isRoutePending()) show();
            else if (phaseRef.current !== "idle") settle();
        };
        const unsubscribe = subscribeRoutePending(sync);
        // 挂载时信号可能已置位(不会再收到通知),同步读一次
        sync();
        return () => {
            unsubscribe();
            window.clearTimeout(hideTimer.current);
            window.clearTimeout(resetTimer.current);
        };
    }, []);

    return (
        <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-60 h-0.5">
            <div
                className={`h-full bg-primary ${
                    phase === "active"
                        ? `opacity-100 ${CREEP_TRANSITION}`
                        : phase === "finishing"
                          ? `opacity-100 ${SETTLE_TRANSITION}`
                          : `opacity-0 ${FADE_TRANSITION}`
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
