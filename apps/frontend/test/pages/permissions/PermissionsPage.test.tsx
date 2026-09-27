// @vitest-environment jsdom
/* 权限页受保护菜单一致性：全选与保存不写入 protected 菜单及其子菜单
 * （勾给普通角色必被后端拒绝，前后端口径必须一致）。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PermissionsPage } from "@/pages/permissions/PermissionsPage";
import { DEFAULT_GRANTS } from "@/data/permissions";
import type { GrantMap, RoleGrant } from "@/data/permissions";

const mutate = vi.fn();

vi.mock("@/context/useApp", () => ({
    useApp: () => ({ can: () => true, refreshProfile: vi.fn(), role: "super" }),
}));
vi.mock("@/components/ui/toastContexts", () => ({ useToast: () => vi.fn() }));
vi.mock("@/data/queries", () => ({
    useWbSnapshot: () => ({ data: undefined, isLoading: false }),
    useGrantLog: () => ({ data: [] }),
    useCreateUser: () => ({ mutate: vi.fn() }),
    useUpdateUser: () => ({ mutate: vi.fn() }),
    useSetUserActive: () => ({ mutate: vi.fn() }),
    useResetUserPassword: () => ({ mutate: vi.fn() }),
    useGrants: () => ({ data: DEFAULT_GRANTS as GrantMap, isLoading: false }),
    useSaveGrants: () => ({ mutate }),
}));

beforeEach(() => {
    mutate.mockReset();
});
afterEach(cleanup);

it("全选并保存：授权请求不含受保护菜单（permissions/system-logs）及其子菜单", () => {
    render(
        <MemoryRouter>
            <PermissionsPage />
        </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "角色与权限" }));

    // admin 默认授权已是全选态：先取消再全选，产生完整草稿后保存
    const selectAll = screen.getByLabelText("全选", { selector: "input" });
    fireEvent.click(selectAll);
    fireEvent.click(selectAll);
    fireEvent.click(screen.getByRole("button", { name: "保存授权" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [payload] = mutate.mock.calls[0] as [{ roleId: string; grant: RoleGrant }];
    const protectedKeys = [
        "permissions",
        "permissions-accounts",
        "permissions-roles",
        "permissions-matrix",
        "system-logs",
    ];
    for (const key of protectedKeys) {
        expect(payload.grant.menus).not.toContain(key);
    }
    expect(payload.grant.actions["system-logs"] ?? []).toEqual([]);
    expect(payload.grant.menus).toContain("orders");
});

it("菜单勾选区不渲染受保护菜单（不可勾给普通角色）", () => {
    render(
        <MemoryRouter>
            <PermissionsPage />
        </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "角色与权限" }));
    // 受保护菜单及其子菜单不出现在勾选区；操作区按先例仍灰色展示受保护动作组
    const menuSection = screen.getByText("菜单权限").parentElement!;
    expect(menuSection.textContent).not.toContain("系统日志");
    expect(menuSection.textContent).not.toContain("用户与权限");
    expect(screen.queryByLabelText("权限矩阵")).toBeNull();
});
