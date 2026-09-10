// @vitest-environment jsdom
/* 错误状态页：覆盖 404/403/500 文案、恢复动作、焦点管理与路由异常映射 */
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from "react-router";

import {
    AppContentErrorBoundary,
    ErrorPage,
    errorPageKindForRouteError,
    RouterErrorPage,
} from "@/pages/error/ErrorPage";

function LocationProbe() {
    const location = useLocation();
    return <output data-testid="location">{location.pathname}</output>;
}

function renderErrorPage(kind: "not-found" | "forbidden" | "server", entries = ["/missing"], initialIndex?: number) {
    return render(
        <MemoryRouter initialEntries={entries} initialIndex={initialIndex}>
            <ErrorPage kind={kind} />
            <LocationProbe />
        </MemoryRouter>,
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("ErrorPage", () => {
    it("explains a missing route and exposes one clear recovery action", () => {
        renderErrorPage("not-found", ["/orders", "/missing?from=bookmark"], 1);

        expect(screen.getByRole("heading", { name: "找不到这个页面" })).toBeInTheDocument();
        expect(screen.queryByText("/missing?from=bookmark")).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: "回到工作台" })).toHaveAttribute("href", "/workbench");
        expect(screen.queryByRole("button", { name: "返回上一页" })).not.toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "找不到这个页面" })).toHaveFocus();
    });

    it("returns to the workbench from a missing route", async () => {
        const user = userEvent.setup();
        renderErrorPage("not-found", ["/orders", "/missing"], 1);

        await user.click(screen.getByRole("link", { name: "回到工作台" }));

        expect(screen.getByTestId("location")).toHaveTextContent("/workbench");
    });

    it("uses distinct permission and server recovery copy", () => {
        const { unmount } = renderErrorPage("forbidden", ["/permissions"]);
        expect(screen.getByRole("heading", { name: "没有访问权限" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "重新加载" })).not.toBeInTheDocument();
        unmount();

        renderErrorPage("server", ["/orders"]);
        expect(screen.getByRole("heading", { name: "页面暂时无法打开" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "重新加载" })).toBeInTheDocument();
    });

    it("turns an unexpected render error into the server state", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        function BrokenPage(): never {
            throw new Error("render failed");
        }

        render(
            <MemoryRouter initialEntries={["/orders"]}>
                <AppContentErrorBoundary>
                    <BrokenPage />
                </AppContentErrorBoundary>
            </MemoryRouter>,
        );

        expect(screen.getByRole("heading", { name: "页面暂时无法打开" })).toBeInTheDocument();
        errorSpy.mockRestore();
    });

    it("renders the router error element for an uncaught route error", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        function BrokenRoute(): never {
            throw new Error("route failed");
        }

        const router = createMemoryRouter(
            [{ path: "/", element: <BrokenRoute />, errorElement: <RouterErrorPage /> }],
            { initialEntries: ["/"] },
        );
        render(<RouterProvider router={router} />);

        expect(await screen.findByRole("heading", { name: "页面暂时无法打开" })).toBeInTheDocument();
        errorSpy.mockRestore();
    });
});

describe("errorPageKindForRouteError", () => {
    it("maps router response statuses and falls back to server errors", () => {
        const routeError = (status: number) => ({ status, statusText: "test", internal: true, data: null });

        expect(errorPageKindForRouteError(routeError(403))).toBe("forbidden");
        expect(errorPageKindForRouteError(routeError(404))).toBe("not-found");
        expect(errorPageKindForRouteError(new Error("boom"))).toBe("server");
    });
});
