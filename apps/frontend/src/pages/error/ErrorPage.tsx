import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { isRouteErrorResponse, Link, useLocation, useRouteError } from "react-router";
import { Icon } from "@/lib/icons";

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

/** 用业务语义替代定位针：三种状态各自使用一张轻量、多色的线性插画。 */
function ErrorArtwork({ kind }: { kind: ErrorPageKind }) {
    return (
        <svg
            aria-hidden="true"
            className="mx-auto h-32 w-32"
            viewBox="0 0 112 112"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            {kind === "not-found" && (
                <>
                    <circle cx="56" cy="56" r="44" fill="var(--color-primary-soft)" />
                    <circle cx="25" cy="29" r="5" fill="var(--color-warning-soft)" />
                    <circle cx="88" cy="83" r="6" fill="var(--color-accent-soft)" />
                    <path
                        d="M35 23.5h30.5L77 35v53.5H35V23.5Z"
                        fill="var(--color-surface)"
                        stroke="var(--color-primary)"
                        strokeWidth="3"
                        strokeLinejoin="round"
                    />
                    <path
                        d="M65.5 23.5V35H77"
                        fill="var(--color-accent-soft)"
                        stroke="var(--color-accent)"
                        strokeWidth="3"
                        strokeLinejoin="round"
                    />
                    <path
                        d="M45 52h21M45 62h14"
                        stroke="var(--color-line-strong)"
                        strokeWidth="4"
                        strokeLinecap="round"
                    />
                    <circle
                        cx="65"
                        cy="75"
                        r="8.5"
                        fill="var(--color-warning-soft)"
                        stroke="var(--color-warning)"
                        strokeWidth="3"
                    />
                    <path
                        d="M65 71.5v.5M65 76v.5"
                        stroke="var(--color-warning)"
                        strokeWidth="3"
                        strokeLinecap="round"
                    />
                </>
            )}

            {kind === "forbidden" && (
                <>
                    <circle cx="56" cy="56" r="44" fill="var(--color-warning-soft)" />
                    <circle cx="26" cy="29" r="5" fill="var(--color-accent-soft)" />
                    <circle cx="88" cy="82" r="6" fill="var(--color-primary-soft)" />
                    <path
                        d="M56 21.5 83 32v20.5c0 18.5-10.9 30-27 38-16.1-8-27-19.5-27-38V32l27-10.5Z"
                        fill="var(--color-surface)"
                        stroke="var(--color-warning)"
                        strokeWidth="3"
                        strokeLinejoin="round"
                    />
                    <rect
                        x="44"
                        y="51"
                        width="24"
                        height="21"
                        rx="5"
                        fill="var(--color-primary-soft)"
                        stroke="var(--color-primary)"
                        strokeWidth="3"
                    />
                    <path
                        d="M49.5 51v-4a6.5 6.5 0 0 1 13 0v4"
                        stroke="var(--color-primary)"
                        strokeWidth="3"
                        strokeLinecap="round"
                    />
                    <circle cx="56" cy="61.5" r="2.5" fill="var(--color-accent)" />
                    <path d="M56 64v4" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" />
                </>
            )}

            {kind === "server" && (
                <>
                    <circle cx="56" cy="56" r="44" fill="var(--color-danger-soft)" />
                    <circle cx="24" cy="81" r="6" fill="var(--color-primary-soft)" />
                    <circle cx="88" cy="29" r="5" fill="var(--color-warning-soft)" />
                    <rect
                        x="23"
                        y="27"
                        width="66"
                        height="57"
                        rx="12"
                        fill="var(--color-surface)"
                        stroke="var(--color-accent)"
                        strokeWidth="3"
                    />
                    <path d="M23 44h66" stroke="var(--color-accent-soft)" strokeWidth="3" />
                    <circle cx="35" cy="35.5" r="2.5" fill="var(--color-danger)" />
                    <circle cx="43" cy="35.5" r="2.5" fill="var(--color-warning)" />
                    <circle cx="51" cy="35.5" r="2.5" fill="var(--color-success)" />
                    <path
                        d="m56 51 12 22H44l12-22Z"
                        fill="var(--color-danger-soft)"
                        stroke="var(--color-danger)"
                        strokeWidth="3"
                        strokeLinejoin="round"
                    />
                    <path d="M56 58v7" stroke="var(--color-danger)" strokeWidth="3" strokeLinecap="round" />
                    <circle cx="56" cy="69" r="1.5" fill="var(--color-danger)" />
                </>
            )}
        </svg>
    );
}

const actionClassName =
    "inline-flex min-h-11 min-w-32 cursor-pointer items-center justify-center gap-2 rounded-btn px-5 text-13.5 font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const primaryActionClassName = `${actionClassName} bg-primary text-white shadow-glow hover:bg-primary-hover`;

/** 应用壳层内的统一错误状态页：用清晰的恢复动作替代技术诊断信息。 */
export function ErrorPage({ kind }: ErrorPageProps) {
    const titleRef = useRef<HTMLHeadingElement>(null);
    const copy = ERROR_PAGE_COPY[kind];

    useEffect(() => {
        document.title = `${copy.title} · 智造管理系统`;
        titleRef.current?.focus();
    }, [copy.title]);

    return (
        <section
            aria-labelledby="error-page-title"
            className="flex min-h-[min(480px,calc(100dvh-9rem))] items-center justify-center py-10 sm:py-14"
        >
            <div className="w-full max-w-lg px-5">
                <div className="mx-auto text-center">
                    <ErrorArtwork kind={kind} />

                    <div role="alert" aria-live="assertive" className="mt-5">
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

                    <div className="mt-6 flex justify-center">
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
            </div>
        </section>
    );
}

/** 将 React Router 的响应错误映射为用户能理解的错误状态。 */
export function errorPageKindForRouteError(error: unknown): ErrorPageKind {
    if (isRouteErrorResponse(error)) {
        if (error.status === 403) return "forbidden";
        if (error.status === 404) return "not-found";
    }
    return "server";
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
    state: RenderErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: unknown): RenderErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: unknown, info: ErrorInfo) {
        if (import.meta.env.DEV) {
            console.error("[render-error]", { pathname: this.props.pathname, error, info });
        }
    }

    render() {
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
