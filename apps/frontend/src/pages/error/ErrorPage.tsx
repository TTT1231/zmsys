import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { Link, useLocation, useRouteError } from "react-router";
import { Icon } from "@/lib/icons";

import { errorPageKindForRouteError } from "./routeError";

export type ErrorPageKind = "not-found" | "forbidden" | "server";

interface ErrorPageProps {
    kind: ErrorPageKind;
}

interface ErrorPageCopy {
    title: string;
    description: string;
}

const ERROR_PAGE_COPY: Record<ErrorPageKind, ErrorPageCopy> = {
    "not-found": {
        title: "找不到这个页面",
        description: "页面可能已被移动或删除。",
    },
    forbidden: {
        title: "没有访问权限",
        description: "如需访问，请联系管理员开通权限。",
    },
    server: {
        title: "页面暂时无法打开",
        description: "请重新加载后再试。",
    },
};

/* 各状态的主视觉：渐变代号数字 + 同色系光晕、虚线轨道与星点（纯装饰，语义由文案承载） */
const KIND_META: Record<ErrorPageKind, { code: string; numerals: string; glow: string; deco: string }> = {
    "not-found": {
        code: "404",
        numerals: "from-indigo-500 via-indigo-400 to-sky-400",
        glow: "bg-indigo-400/25",
        deco: "text-indigo-300",
    },
    forbidden: {
        code: "403",
        numerals: "from-amber-500 via-amber-400 to-orange-400",
        glow: "bg-amber-400/25",
        deco: "text-amber-300",
    },
    server: {
        code: "500",
        numerals: "from-rose-500 via-rose-400 to-orange-400",
        glow: "bg-rose-400/25",
        deco: "text-rose-300",
    },
};

function ErrorArtwork({ kind }: { kind: ErrorPageKind }) {
    const meta = KIND_META[kind];
    return (
        <div aria-hidden="true" className="relative mx-auto w-fit animate-rise select-none">
            {/* 数字背后的同色系柔光 */}
            <div
                className={`absolute top-1/2 left-1/2 h-36 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl ${meta.glow}`}
            />
            {/* 虚线轨道与星点 */}
            <svg
                className={`absolute top-1/2 left-1/2 h-40 w-90 -translate-x-1/2 -translate-y-1/2 ${meta.deco}`}
                viewBox="0 0 360 160"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
            >
                <ellipse
                    cx="180"
                    cy="80"
                    rx="168"
                    ry="56"
                    transform="rotate(-6 180 80)"
                    stroke="currentColor"
                    strokeOpacity="0.7"
                    strokeWidth="2.5"
                    strokeDasharray="2 9"
                    strokeLinecap="round"
                />
                <path
                    d="M30 42h12M36 36v12"
                    stroke="currentColor"
                    strokeOpacity="0.9"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                />
                <path
                    d="M318 118h10M323 113v10"
                    stroke="currentColor"
                    strokeOpacity="0.8"
                    strokeWidth="2"
                    strokeLinecap="round"
                />
                <circle cx="60" cy="122" r="3" fill="currentColor" fillOpacity="0.6" />
                <circle cx="308" cy="34" r="2.5" fill="currentColor" fillOpacity="0.55" />
                <circle cx="164" cy="16" r="2" fill="currentColor" fillOpacity="0.5" />
            </svg>
            <div
                className={`relative bg-linear-to-br ${meta.numerals} bg-clip-text text-88 leading-none font-bold tracking-tighter text-transparent`}
            >
                {meta.code}
            </div>
        </div>
    );
}

const actionClassName =
    "inline-flex min-h-11 min-w-32 cursor-pointer items-center justify-center gap-2 rounded-btn px-5 text-13.5 font-semibold transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const primaryActionClassName = `${actionClassName} bg-primary text-white shadow-glow hover:bg-primary-hover active:scale-[0.98]`;

/** 应用壳层内的统一错误状态页：用清晰的恢复动作替代技术诊断信息。 */
export function ErrorPage({ kind }: ErrorPageProps) {
    const titleRef = useRef<HTMLHeadingElement>(null);
    const copy = ERROR_PAGE_COPY[kind];

    useEffect(() => {
        document.title = `${copy.title} · 众茂生产系统`;
        titleRef.current?.focus();
    }, [copy.title]);

    return (
        <section
            aria-labelledby="error-page-title"
            className="relative flex min-h-[calc(100dvh-9rem)] items-center justify-center overflow-hidden py-10 sm:py-14"
        >
            {/* 细网格背景，边缘径向渐隐（纯装饰） */}
            <div
                className="absolute inset-0"
                style={{
                    backgroundImage:
                        "linear-gradient(rgba(16,24,40,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(16,24,40,0.05) 1px, transparent 1px)",
                    backgroundSize: "46px 46px",
                    maskImage: "radial-gradient(ellipse 70% 65% at 50% 42%, black 30%, transparent 75%)",
                    WebkitMaskImage: "radial-gradient(ellipse 70% 65% at 50% 42%, black 30%, transparent 75%)",
                }}
                aria-hidden="true"
            />

            <div className="relative w-full max-w-lg px-5 text-center">
                <ErrorArtwork kind={kind} />

                <div role="alert" aria-live="assertive" className="mt-6">
                    <h1
                        ref={titleRef}
                        id="error-page-title"
                        tabIndex={-1}
                        className="text-24 leading-tight font-semibold tracking-[-0.03em] text-ink outline-none"
                    >
                        {copy.title}
                    </h1>
                    <p className="mx-auto mt-2 text-14 leading-6 text-muted">{copy.description}</p>
                </div>

                <div className="mt-8 flex justify-center">
                    {kind === "server" ? (
                        <button
                            type="button"
                            className={primaryActionClassName}
                            onClick={() => window.location.reload()}
                        >
                            <Icon name="refresh" size={17} />
                            重新加载
                        </button>
                    ) : (
                        <Link to="/workbench" replace className={primaryActionClassName}>
                            回到工作台
                        </Link>
                    )}
                </div>
            </div>
        </section>
    );
}

/** 根路由 ErrorElement：兜住路由加载、loader/action 以及未预期的路由级异常。 */
export function RouterErrorPage() {
    const error = useRouteError();
    const location = useLocation();
    const kind = errorPageKindForRouteError(error);

    useEffect(() => {
        if (import.meta.env.DEV) {
            console.error("[route-error]", { pathname: location.pathname, error });
        }
    }, [error, location.pathname]);

    return (
        <main className="min-h-dvh bg-canvas px-4 sm:px-6">
            <ErrorPage kind={kind} />
        </main>
    );
}

interface RenderErrorBoundaryProps {
    children: ReactNode;
    pathname: string;
}

interface RenderErrorBoundaryState {
    error: unknown | null;
}

class RenderErrorBoundaryInner extends Component<RenderErrorBoundaryProps, RenderErrorBoundaryState> {
    override state: RenderErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: unknown): RenderErrorBoundaryState {
        return { error };
    }

    override componentDidCatch(error: unknown, info: ErrorInfo) {
        if (import.meta.env.DEV) {
            console.error("[render-error]", { pathname: this.props.pathname, error, info });
        }
    }

    override render() {
        if (this.state.error) return <ErrorPage kind="server" />;
        return this.props.children;
    }
}

/** 保留应用壳层的渲染异常兜底，也能接住懒加载 chunk 加载失败。 */
export function AppContentErrorBoundary({ children }: { children: ReactNode }) {
    const location = useLocation();
    const pathname = `${location.pathname}${location.search}${location.hash}`;

    return (
        <RenderErrorBoundaryInner key={location.key} pathname={pathname}>
            {children}
        </RenderErrorBoundaryInner>
    );
}
