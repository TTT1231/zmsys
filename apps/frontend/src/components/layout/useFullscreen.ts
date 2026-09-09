import { useCallback, useEffect, useState } from "react";

/* 浏览器全屏:原生 requestFullscreen / exitFullscreen + fullscreenchange 监听。
   受限环境(iframe、iOS Safari)拒绝时静默;supported=false 时顶栏按钮不渲染 */
export function useFullscreen() {
    const supported = typeof document.documentElement.requestFullscreen === "function";
    const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement);

    useEffect(() => {
        const onChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", onChange);
        return () => document.removeEventListener("fullscreenchange", onChange);
    }, []);

    const toggle = useCallback(() => {
        if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => {});
        } else {
            void document.documentElement.requestFullscreen().catch(() => {});
        }
    }, []);

    return { supported, isFullscreen, toggle };
}
