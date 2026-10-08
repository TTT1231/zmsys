// @vitest-environment jsdom
/* 权限页受保护菜单一致性：全选与保存不写入 protected 菜单及其子菜单
 * （勾给普通角色必被后端拒绝，前后端口径必须一致）。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PermissionsPage } from "@/pages/permissions/PermissionsPage";
import { DEFAULT_GRANTS, MENU_CATALOG } from "@/data/permissions";
import { EMPTY_SNAPSHOT } from "@/data/views";
import type { GrantMap, RoleGrant } from "@/data/permissions";

const mutate = vi.fn();

vi.mock("@/context/useApp", () => ({
    useApp: () => ({ can: () => true, refreshProfile: vi.fn(), role: "super" }),
}));
vi.mock("@/components/ui/toastContexts", () => ({ useToast: () => vi.fn() }));
vi.mock("@/data/queries", () => ({
    useWbView: () => ({ snap: EMPTY_SNAPSHOT, isLoading: false, refreshing: false }),
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

    // admin 默认未授「分析页」：全选初始未勾，单击一次产生完整草稿后保存
    const selectAll = screen.getByLabelText("全选", { selector: "input" });
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
    expect(payload.grant.menus).toContain("analytics");
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

it("系统组矩阵不把普通角色的脏菜单授权显示为可访问", () => {
    const probeKey = "system-evidence-test";
    MENU_CATALOG.push({ key: probeKey, label: "系统权限验证", icon: "log", group: "系统" });
    const originalSuperGrant = DEFAULT_GRANTS.super;
    const originalStaffGrant = DEFAULT_GRANTS.staff;
    DEFAULT_GRANTS.super = { ...originalSuperGrant, menus: [...originalSuperGrant.menus, probeKey] };
    DEFAULT_GRANTS.staff = {
        ...originalStaffGrant,
        menus: [...originalStaffGrant.menus, probeKey],
    };
    try {
        render(
            <MemoryRouter>
                <PermissionsPage />
            </MemoryRouter>,
        );
        fireEvent.click(screen.getByRole("tab", { name: "权限矩阵" }));
        const row = screen.getByRole("row", { name: /系统权限验证/ });
        const cells = within(row).getAllByRole("cell");
        expect(cells).toHaveLength(5);
        expect(cells[0]).toHaveTextContent("可见");
        expect(cells[4]).toHaveTextContent("—");
    } finally {
        MENU_CATALOG.pop();
        DEFAULT_GRANTS.super = originalSuperGrant;
        DEFAULT_GRANTS.staff = originalStaffGrant;
    }
});
