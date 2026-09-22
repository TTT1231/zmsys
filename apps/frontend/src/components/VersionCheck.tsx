import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { extractBuildId } from "@/lib/build-id";
import { Icon } from "@/lib/icons";

/** 轮询间隔：5 分钟（另在切回标签页时立即检查，感知延迟远小于间隔） */
const POLL_INTERVAL_MS = 5 * 60_000;
/** 检测地址：index.html 本体；cache: no-cache 强制回源校验，绕过浏览器启发式缓存 */
const INDEX_URL = "/index.html";
/** 切回标签页立即检查的节流窗口，避免可见性抖动触发连发请求 */
const VISIBLE_THROTTLE_MS = 1000;

/* 新版本检测：定时 + 切回标签页拉取线上 index.html 的构建标识与当前页面对比，
   发现新部署先弹「新版本可用」对话框（文案对齐 vben）；用户取消后顶部保留
   常驻横幅，点击横幅或「刷新」按钮 location.reload() 拿到新构建。
   DEV 不启用——dev server 每次重写 index.html，构建标识无意义 */
export function VersionCheck() {
    const [modalOpen, setModalOpen] = useState(false);
    const [bannerVisible, setBannerVisible] = useState(false);
    /* 已取消过弹窗：后续检测（比如又发了一版）只保证横幅在场，不再打扰 */
    const dismissedRef = useRef(false);
    /* 检测进行中标记：定时器与切回标签页并发触发时只跑一次 */
    const checkingRef = useRef(false);
    const cancelBtnRef = useRef<HTMLButtonElement>(null);
    const refreshBtnRef = useRef<HTMLButtonElement>(null);

    const check = useCallback(async () => {
        if (checkingRef.current) return;
        checkingRef.current = true;
        try {
            const current = document.querySelector<HTMLMetaElement>('meta[name="app-build-id"]')?.content;
            const response = await fetch(INDEX_URL, { cache: "no-cache" });
            if (!response.ok) return;
            const latest = extractBuildId(await response.text());
            if (!current || !latest || latest === current) return;
            if (dismissedRef.current) setBannerVisible(true);
            else setModalOpen(true);
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

    /* 弹窗打开后焦点落在「刷新」主按钮，键盘用户可直接回车刷新；
       layoutEffect 在 paint 前同步执行，避免并发渲染间隙里焦点短暂落回 body */
    useLayoutEffect(() => {
        if (modalOpen) refreshBtnRef.current?.focus();
    }, [modalOpen]);

    const reload = () => window.location.reload();
    const cancel = () => {
        dismissedRef.current = true;
        setModalOpen(false);
        setBannerVisible(true);
    };

    /* ESC 取消、Tab 圈定在弹窗内（弹窗只有两个按钮，遮罩不可点关，必须二选一） */
    const onDialogKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === "Escape") {
            event.preventDefault();
            cancel();
            return;
        }
        if (event.key === "Tab") {
            const [first, last] = [cancelBtnRef.current, refreshBtnRef.current];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        }
    };

    return (
        <>
            {/* 横幅必须留在文档流（组件挂载于应用树之前，见 main.tsx）：占位推下全部
                内容且滚动吸顶；portal 到 body 会落在 #root 之后，流位置在页尾，
                sticky 的钉住阈值永远无法触达 */}
            {bannerVisible && (
                <div
                    role="button"
                    tabIndex={0}
                    onClick={reload}
                    onKeyDown={event => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            reload();
                        }
                    }}
                    className="sticky top-0 z-140 flex h-11 cursor-pointer items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 px-12 text-13 font-medium text-white hover:brightness-110"
                >
                    <Icon name="refresh" size={15} />
                    <span>新版本可用</span>
                    <span className="font-normal opacity-85">点击刷新以获取最新版本</span>
                </div>
            )}
            {/* 弹窗遮罩需脱离布局流，继续 portal 到 body */}
            {modalOpen &&
                createPortal(
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
                            <h2 id="version-check-title" className="text-16.5 font-semibold text-ink">
                                新版本可用
                            </h2>
                            <p className="mx-auto mt-1.5 max-w-[30ch] text-12.5 text-muted">点击刷新以获取最新版本</p>
                            <div className="mt-5.5 flex justify-center gap-2.5">
                                <button
                                    type="button"
                                    ref={cancelBtnRef}
                                    onClick={cancel}
                                    className="inline-flex min-h-9.5 min-w-24 items-center justify-center rounded-btn border border-line bg-surface px-4 text-13 font-medium text-ink hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/40"
                                >
                                    取消
                                </button>
                                <button
                                    type="button"
                                    ref={refreshBtnRef}
                                    onClick={reload}
                                    className="inline-flex min-h-9.5 min-w-24 items-center justify-center gap-1.5 rounded-btn bg-primary px-4 text-13 font-medium text-white hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/40"
                                >
                                    <Icon name="refresh" size={14} />
                                    刷新
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    );
}
