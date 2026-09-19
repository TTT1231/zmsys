import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router";
import { isRoutePending, subscribeRoutePending } from "@/lib/route-pending";

type Phase = "idle" | "active" | "finishing";

/** 起步位:对齐 nprogress minimum(0.08),进度条出现即站在 8%,不从 0 空爬 */
const MIN_START = 8;
/** 加载期爬升上限:信号不结束也只逼近不到达(nprogress 0.994 封顶的近似) */
const CREEP_TARGET = 88;
/* 加载期宽度爬升:3 秒 CSS 过渡逼近 88%,前快后慢,短窗口只用到曲线前段 */
const CREEP_TRANSITION = "transition-[width] duration-3000 ease-[cubic-bezier(0.1,0.35,0.25,1)]";
/* 归零退场:width 冲向 100% 与 opacity 淡出并行,无满格停留(对齐 vben speed: 300 与 nprogress set(1) 语义) */
const SETTLE_TRANSITION = "transition-all duration-300 ease-out";
/** 冲刺与淡出并行时长,完成后 width 静默回到起步位 */
const SETTLE_MS = 300;

/* 顶部路由进度条(借鉴 vben/nprogress 的事件对模型):route-pending 出现路由级加载
   (懒加载 chunk / 认证校验)即显示,归零即冲满并同步淡出,全程由订阅事件驱动;
   宽度推进交给 CSS 过渡,无轮询、无最小展示时长——缓存命中的瞬时切换不出现进度条,
   页面数据加载由页面内占位表达,不进这条链路 */
export function RouteProgressBar() {
    /* width 常驻起步位:不可见时也停在 MIN_START,下一轮天然从 8% 起步 */
    const [phase, setPhase] = useState<Phase>("idle");
    const [width, setWidth] = useState(MIN_START);
    const phaseRef = useRef<Phase>("idle");
    const resetTimer = useRef<number | undefined>(undefined);

    useEffect(() => {
        const show = () => {
            window.clearTimeout(resetTimer.current);
            // 退场中途新加载开始时不倒退,从当前值继续爬
            setWidth(prev => Math.max(CREEP_TARGET, prev));
            phaseRef.current = "active";
            setPhase("active");
        };
        const settle = () => {
            setWidth(100);
            phaseRef.current = "finishing";
            setPhase("finishing");
            // 并行退场完成后回到起步位(此刻 opacity 已为 0,不可见)
            resetTimer.current = window.setTimeout(() => {
                phaseRef.current = "idle";
                setPhase("idle");
                setWidth(MIN_START);
            }, SETTLE_MS);
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
                          ? `opacity-0 ${SETTLE_TRANSITION}`
                          : "opacity-0"
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
