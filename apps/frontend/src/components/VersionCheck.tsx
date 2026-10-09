import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { extractBuildId } from "@/lib/build-id";
import { Icon } from "@/lib/icons";
import { reloadPage } from "@/lib/utils";

/** 轮询间隔：5 分钟（另在切回标签页时立即检查，感知延迟远小于间隔） */
const POLL_INTERVAL_MS = 5 * 60_000;
/** 检测地址：index.html 本体；cache: no-cache 强制回源校验，绕过浏览器启发式缓存 */
const INDEX_URL = "/index.html";
/** 切回标签页立即检查的节流窗口，避免可见性抖动触发连发请求 */
const VISIBLE_THROTTLE_MS = 1000;

/* 新版本强制更新：定时 + 切回标签页拉取线上 index.html 的构建标识与当前页面对比，
   发现新部署立即弹出不可关闭的全屏遮罩（无取消入口），旧版本页面从此无法继续
   任何操作，只能刷新拿到新构建——避免停留在旧版的用户按旧业务逻辑继续产生
   与新逻辑不一致的数据。
   DEV 不启用——dev server 每次重写 index.html，构建标识无意义 */
export function VersionCheck() {
    const [outdated, setOutdated] = useState(false);
    /* 已进入强制更新态：后续检测（又发了一版等）直接跳过，刷新后自然拿到最新 */
    const outdatedRef = useRef(false);
    /* 检测进行中标记：定时器与切回标签页并发触发时只跑一次 */
    const checkingRef = useRef(false);
    const refreshBtnRef = useRef<HTMLButtonElement>(null);

    const check = useCallback(async () => {
        if (outdatedRef.current || checkingRef.current) return;
        checkingRef.current = true;
        try {
            const current = document.querySelector<HTMLMetaElement>('meta[name="app-build-id"]')?.content;
            const response = await fetch(INDEX_URL, { cache: "no-cache" });
            if (!response.ok) return;
            const latest = extractBuildId(await response.text());
            if (!current || !latest || latest === current) return;
            outdatedRef.current = true;
            setOutdated(true);
        } catch {
            /* 网络异常静默，等下一轮 */
        } finally {
            checkingRef.current = false;
        }
    }, []);

    useEffect(() => {
        if (import.meta.env.DEV) return;
        let timer: number | undefined;
        let lastVisibleCheck = 0;
        const start = () => {
            window.clearInterval(timer);
            timer = window.setInterval(check, POLL_INTERVAL_MS);
        };
        const onVisibility = () => {
            if (document.hidden) {
                window.clearInterval(timer);
            } else {
                if (Date.now() - lastVisibleCheck < VISIBLE_THROTTLE_MS) {
                    start();
                    return;
                }
                lastVisibleCheck = Date.now();
                void check().finally(start);
            }
        };
        start();
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            document.removeEventListener("visibilitychange", onVisibility);
            window.clearInterval(timer);
        };
    }, [check]);

    /* 遮罩出现后焦点落在「立即刷新」主按钮，键盘用户可直接回车刷新；
       layoutEffect 在 paint 前同步执行，避免并发渲染间隙里焦点短暂落回 body */
    useLayoutEffect(() => {
        if (outdated) refreshBtnRef.current?.focus();
    }, [outdated]);

    /* 强制更新：ESC / Tab 均不转移或关闭（唯一可聚焦元素就是刷新按钮），
       遮罩不可点关——必须刷新后才能继续使用 */
    const onDialogKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === "Escape" || event.key === "Tab") event.preventDefault();
    };

    if (!outdated) return null;

    return createPortal(
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="version-check-title"
            onKeyDown={onDialogKeyDown}
            className="fixed inset-0 z-150 flex items-center justify-center bg-scrim p-4 backdrop-blur-[2px]"
        >
            <div className="w-90 max-w-full rounded-panel bg-surface px-6 pb-5.5 pt-6.5 text-center shadow-modal">
                <div className="mx-auto mb-3.5 grid size-14 place-items-center rounded-full bg-primary-soft text-primary">
                    <Icon name="refresh" size={26} />
                </div>
                <h2 id="version-check-title" className="text-17 font-semibold text-ink">
                    系统已更新
                </h2>
                <p className="mx-auto mt-1.5 max-w-[30ch] text-13 text-muted">
                    检测到新版本已发布，为避免数据不一致，请刷新页面继续使用
                </p>
                <button
                    type="button"
                    ref={refreshBtnRef}
                    onClick={reloadPage}
                    className="mt-5.5 inline-flex min-h-9.5 min-w-24 items-center justify-center gap-1.5 rounded-btn bg-primary px-4 text-14 font-medium text-white hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/40"
                >
                    <Icon name="refresh" size={14} />
                    立即刷新
                </button>
            </div>
        </div>,
        document.body,
    );
}
