// @vitest-environment jsdom
/* 二级侧边菜单：手风琴展开（aria-expanded）、当前路由所在组自动展开、激活链接选中态、note 项弹窗 */
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { SidebarMenu } from "@/components/layout/SidebarMenu";
import type { NavSection } from "@/data/permissions";

const sections: NavSection[] = [
    {
        group: "工作台",
        icon: "chart",
        items: [
            { label: "工作台", icon: "grid", to: "/workbench", end: true },
            { label: "归档订单", icon: "archive", to: "/archived-orders" },
        ],
    },
    {
        group: "业务导航",
        icon: "cube",
        items: [
            { label: "销售订单", icon: "order", to: "/orders" },
            { label: "变更记录", icon: "log", note: "审计记录：业务操作均保留操作人与时间。" },
        ],
    },
];

function renderAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="*" element={<SidebarMenu sections={sections} />} />
            </Routes>
        </MemoryRouter>,
    );
}

const groupButton = (name: string) => screen.getByRole("button", { name });

afterEach(cleanup);

describe("SidebarMenu", () => {
    it("自动展开当前路由所在组，其余组收起（手风琴）", () => {
        renderAt("/orders");
        expect(groupButton("业务导航")).toHaveAttribute("aria-expanded", "true");
        expect(groupButton("工作台")).toHaveAttribute("aria-expanded", "false");
    });

    it("点击组头切换展开，一次只开一组", async () => {
        const user = userEvent.setup();
        renderAt("/orders");
        await user.click(groupButton("工作台"));
        expect(groupButton("工作台")).toHaveAttribute("aria-expanded", "true");
        expect(groupButton("业务导航")).toHaveAttribute("aria-expanded", "false");
        await user.click(groupButton("工作台"));
        expect(groupButton("工作台")).toHaveAttribute("aria-expanded", "false");
    });

    it("当前页二级项带选中态", () => {
        renderAt("/orders");
        const link = screen.getByRole("link", { name: "销售订单" });
        expect(link).toHaveClass("bg-primary-soft");
    });

    it("note 型入口点击弹出说明弹窗", async () => {
        const user = userEvent.setup();
        renderAt("/orders");
        await user.click(screen.getByRole("button", { name: "变更记录" }));
        expect(await screen.findByText(/审计记录：业务操作均保留操作人与时间/)).toBeVisible();
    });
});
