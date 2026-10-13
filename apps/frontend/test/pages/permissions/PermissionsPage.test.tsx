// @vitest-environment jsdom
/* 权限页受保护口径一致性：灰显/全选/矩阵均按运行时 protectedCodes（超管可解锁）
 * 驱动；「受保护权限」页签仅超管可见，开关经确认弹窗调用切换接口。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PermissionsPage } from "@/pages/permissions/PermissionsPage";
import { ACTION_CATALOG, DEFAULT_GRANTS, DEFAULT_PROTECTED_CODES, MENU_CATALOG } from "@/data/permissions";
import { EMPTY_SNAPSHOT } from "@/data/views";
import type { PermissionCatalogEntry } from "@/api";
import type { GrantMap, RoleGrant } from "@/data/permissions";

const mutate = vi.fn();
const protectionMutate = vi.fn();

/* useApp mock 的可变状态：受保护集与角色按用例切换（vi.hoisted 保证 mock 工厂可用） */
const state = vi.hoisted(() => ({
    protectedCodes: null as ReadonlySet<string> | null,
    role: "super" as string,
}));

vi.mock("@/context/useApp", () => ({
    useApp: () => ({
        can: () => true,
        refreshProfile: vi.fn(),
        role: state.role,
        user: { role: state.role },
        grant: DEFAULT_GRANTS.super,
        protectedCodes: state.protectedCodes ?? new Set<string>(),
    }),
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
    usePermissionCatalog: () => ({ data: catalogFixture, isLoading: false }),
    useProtectionLog: () => ({ data: [] }),
    useSetPermissionProtection: () => ({ mutate: protectionMutate, isPending: false }),
}));

/* 目录 fixture：由字典 + 兜底受保护全集推导（protected 与后端运行时一致） */
const catalogFixture: PermissionCatalogEntry[] = [
    ...MENU_CATALOG.flatMap(menu => [
        {
            code: `menu:${menu.key}`,
            kind: "MENU" as const,
            menuKey: menu.key,
            actionId: null,
            label: menu.label,
            protected: DEFAULT_PROTECTED_CODES.has(`menu:${menu.key}`),
        },
        ...(menu.children ?? []).map(child => ({
            code: `menu:${child.key}`,
            kind: "MENU" as const,
            menuKey: child.key,
            actionId: null,
            label: child.label,
            protected: DEFAULT_PROTECTED_CODES.has(`menu:${child.key}`),
        })),
    ]),
    ...(Object.entries(ACTION_CATALOG) as Array<[string, readonly { id: string; label: string }[]]>).flatMap(
        ([menu, actions]) =>
            actions.map(action => ({
                code: `${menu}:${action.id}`,
                kind: "ACTION" as const,
                menuKey: menu,
                actionId: action.id,
                label: action.label,
                protected: DEFAULT_PROTECTED_CODES.has(`${menu}:${action.id}`),
            })),
    ),
];

beforeEach(() => {
    mutate.mockReset();
    protectionMutate.mockReset();
    state.protectedCodes = DEFAULT_PROTECTED_CODES;
    state.role = "super";
});
afterEach(cleanup);

/* 「系统日志」等文案同时出现在菜单行与动作组标题，按结构定位目标元素 */
const labelsOf = (text: string) =>
    screen
        .getAllByText(text)
        .map(element => element.closest("label"))
        .filter(Boolean);
const switchOf = (text: string) =>
    screen.getAllByText(text).find(element => element.closest('button[role="switch"]') !== null);

it("全选并保存：仍受保护的菜单（permissions 系）不入授权；已降级的系统日志正常写入", () => {
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
    const protectedKeys = ["permissions", "permissions-accounts", "permissions-roles", "permissions-matrix"];
    for (const key of protectedKeys) {
        expect(payload.grant.menus).not.toContain(key);
    }
    // 系统日志已降为普通可授权码：全选即写入菜单与查看动作
    expect(payload.grant.menus).toContain("system-logs");
    expect(payload.grant.actions["system-logs"]).toEqual(["view"]);
    expect(payload.grant.menus).toContain("orders");
    expect(payload.grant.menus).toContain("analytics");
});

it("解锁后受保护菜单/动作变为可勾选，全选随之写入", () => {
    // 菜单码与执行动作一并解锁（口径与后端逐码切换一致）
    state.protectedCodes = new Set([...DEFAULT_PROTECTED_CODES].filter(code => !code.includes("system-backup")));
    const { unmount } = render(
        <MemoryRouter>
            <PermissionsPage />
        </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "角色与权限" }));

    // 解锁后备份菜单行是可交互 label（受保护态为灰显 div，无 label 包裹）
    expect(labelsOf("备份").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText("全选", { selector: "input" }));
    fireEvent.click(screen.getByRole("button", { name: "保存授权" }));
    const [payload] = mutate.mock.calls[0] as [{ roleId: string; grant: RoleGrant }];
    expect(payload.grant.menus).toContain("system-backup");
    expect(payload.grant.actions["system-backup"]).toEqual(["run"]);
    unmount();
});

it("受保护动作芯片灰显不可勾；从受保护集移除后恢复可勾选", () => {
    const { unmount } = render(
        <MemoryRouter>
            <PermissionsPage />
        </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "角色与权限" }));
    const lockedChip = screen.getByText("删除订单").closest("label")!;
    expect(lockedChip.querySelector("input")).toBeDisabled();
    unmount();

    state.protectedCodes = new Set([...DEFAULT_PROTECTED_CODES].filter(code => code !== "orders:delete"));
    render(
        <MemoryRouter>
            <PermissionsPage />
        </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "角色与权限" }));
    const unlockedChip = screen.getByText("删除订单").closest("label")!;
    expect(unlockedChip.querySelector("input")).not.toBeDisabled();
});

it("菜单勾选区不渲染受保护菜单为可勾选项（灰显举证）", () => {
    render(
        <MemoryRouter>
            <PermissionsPage />
        </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "角色与权限" }));
    // 受保护菜单以灰显行举证（非 label 可勾选结构）；操作区按先例仍灰色展示受保护动作组
    expect(labelsOf("备份")).toHaveLength(0);
    expect(labelsOf("用户与权限")).toHaveLength(0);
    expect(screen.queryByLabelText("权限矩阵")).toBeNull();
    // 系统日志已降为普通可授权码：默认即渲染为可勾选 label
    expect(labelsOf("系统日志").length).toBeGreaterThan(0);
});

it("系统组矩阵：仍受保护的模块统一「超管专属」举证；解锁后按实时授权派生", () => {
    const probeKey = "system-evidence-test";
    MENU_CATALOG.push({ key: probeKey, label: "系统权限验证", icon: "log", group: "系统" });
    const originalSuperGrant = DEFAULT_GRANTS.super;
    const originalStaffGrant = DEFAULT_GRANTS.staff;
    DEFAULT_GRANTS.super = { ...originalSuperGrant, menus: [...originalSuperGrant.menus, probeKey] };
    DEFAULT_GRANTS.staff = { ...originalStaffGrant, menus: [...originalStaffGrant.menus, probeKey] };
    try {
        // 仍受保护：系统组超管列统一「超管专属」，普通角色「—」（与脏授权无关）
        state.protectedCodes = new Set([...DEFAULT_PROTECTED_CODES, `menu:${probeKey}`]);
        const { unmount } = render(
            <MemoryRouter>
                <PermissionsPage />
            </MemoryRouter>,
        );
        fireEvent.click(screen.getByRole("tab", { name: "权限矩阵" }));
        const lockedRow = screen.getByRole("row", { name: /系统权限验证/ });
        const lockedCells = within(lockedRow).getAllByRole("cell");
        expect(lockedCells[0]).toHaveTextContent("超管专属");
        expect(lockedCells[4]).toHaveTextContent("—");
        unmount();

        // 解锁：按各角色实时授权正常派生（probe 无动作目录 → 可见）
        state.protectedCodes = new Set(DEFAULT_PROTECTED_CODES);
        render(
            <MemoryRouter>
                <PermissionsPage />
            </MemoryRouter>,
        );
        fireEvent.click(screen.getByRole("tab", { name: "权限矩阵" }));
        const derivedRow = screen.getByRole("row", { name: /系统权限验证/ });
        const derivedCells = within(derivedRow).getAllByRole("cell");
        expect(derivedCells[0]).toHaveTextContent("可见");
        expect(derivedCells[4]).toHaveTextContent("可见");
    } finally {
        MENU_CATALOG.pop();
        DEFAULT_GRANTS.super = originalSuperGrant;
        DEFAULT_GRANTS.staff = originalStaffGrant;
    }
});

it("「受保护权限」页签：仅超管可见；开关经确认弹窗携带原因调用切换接口", () => {
    render(
        <MemoryRouter>
            <PermissionsPage />
        </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "受保护权限" }));

    // 备份菜单行开关 → 解锁确认弹窗（填原因）→ 调用 PATCH 语义的 mutation
    fireEvent.click(switchOf("备份")!.closest('button[role="switch"]')!);
    expect(screen.getByText("解锁【备份】")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("原因（选填，记入保护开关日志）"), {
        target: { value: "下放给管理员" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认解锁" }));
    expect(protectionMutate).toHaveBeenCalledTimes(1);
    const [payload] = protectionMutate.mock.calls[0] as [{ code: string; protected: boolean; reason?: string }];
    expect(payload).toEqual({ code: "menu:system-backup", protected: false, reason: "下放给管理员" });
});

it("非超管不渲染「受保护权限」页签", () => {
    state.role = "staff";
    render(
        <MemoryRouter>
            <PermissionsPage />
        </MemoryRouter>,
    );
    expect(screen.queryByRole("tab", { name: "受保护权限" })).toBeNull();
});
