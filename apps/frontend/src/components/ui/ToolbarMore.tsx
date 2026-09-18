import type { ReactNode } from "react";

export function ToolbarMore({ children }: { children: ReactNode }) {
    return (
        <>
            <div className="hidden items-center gap-2 lg:flex">{children}</div>
            <details className="toolbar-more relative ml-auto lg:hidden">
                <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-btn border border-line px-3 text-14 text-muted">
                    更多
                </summary>
                <div
                    className="absolute right-0 top-full z-20 mt-2 flex min-w-35 flex-col gap-2 rounded-xl border border-line bg-white p-2 shadow-modal"
                    onClick={event => {
                        if ((event.target as HTMLElement).closest("button"))
                            event.currentTarget.closest("details")?.removeAttribute("open");
                    }}
                >
                    {children}
                </div>
            </details>
        </>
    );
}
