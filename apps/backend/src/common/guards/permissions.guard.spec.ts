import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { PermissionsGuard } from "./permissions.guard";
import type { AuthUser } from "../types/auth-user";

function createContext(
    user: AuthUser | undefined,
    permissionsMetadata: unknown,
    flags: { isPublic?: boolean; authOnly?: boolean; superOnly?: unknown } = {},
) {
    const reflector = {
        getAllAndOverride: (key: string) => {
            if (key === "requiredPermissions") return permissionsMetadata;
            if (key === "isPublic") return flags.isPublic ?? false;
            if (key === "authenticatedOnly") return flags.authOnly ?? false;
            if (key === "superOnly") return flags.superOnly;
            return undefined;
        },
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    const ctx = {
        getHandler: () => () => undefined,
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
    return { guard, ctx };
}

const superUser: AuthUser = {
    id: "1",
    account: "guojun",
    name: "郭均",
    role: "super",
    isSuper: true,
    rowVersion: 1,
    permissions: new Set(),
};

const staffUser: AuthUser = {
    id: "2",
    account: "test",
    name: "测试员工",
    role: "staff",
    isSuper: false,
    rowVersion: 1,
    permissions: new Set(["menu:workbench", "orders:view"]),
};

describe("PermissionsGuard（默认拒绝）", () => {
    it("未声明任何访问策略的端点直接 403（漏写装饰器不放行）", () => {
        const { guard, ctx } = createContext(staffUser, undefined);
        expect(() => guard.canActivate(ctx)).toThrow(new ForbiddenException("端点未声明访问策略，默认拒绝"));
    });

    it("@Public() 端点放行", () => {
        const { guard, ctx } = createContext(undefined, undefined, { isPublic: true });
        expect(guard.canActivate(ctx)).toBe(true);
    });

    it("@AuthenticatedOnly() 端点仅需登录（JWT 守卫已保证）", () => {
        const { guard, ctx } = createContext(staffUser, undefined, { authOnly: true });
        expect(guard.canActivate(ctx)).toBe(true);
    });

    it("super 直通所有权限码", () => {
        const { guard, ctx } = createContext(superUser, {
            codes: ["permissions:view"],
            message: "无权",
        });
        expect(guard.canActivate(ctx)).toBe(true);
    });

    it("持有全部要求权限码时放行", () => {
        const { guard, ctx } = createContext(staffUser, {
            codes: ["orders:view"],
            message: "无权",
        });
        expect(guard.canActivate(ctx)).toBe(true);
    });

    it("缺少任一权限码时抛出 403 并携带端点文案", () => {
        const { guard, ctx } = createContext(staffUser, {
            codes: ["permissions:view"],
            message: "无权查看角色",
        });
        expect(() => guard.canActivate(ctx)).toThrow(new ForbiddenException("无权查看角色"));
    });

    it("要求多个权限码时任一缺失即拒绝", () => {
        const { guard, ctx } = createContext(staffUser, {
            codes: ["orders:view", "permissions:manage"],
            message: "无权",
        });
        expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it("@SuperOnly() 端点：super 角色直通", () => {
        const { guard, ctx } = createContext(superUser, undefined, {
            superOnly: { message: "仅超级管理员可调整受保护权限" },
        });
        expect(guard.canActivate(ctx)).toBe(true);
    });

    it("@SuperOnly() 端点：非 super 即使持全部权限码也 403（不经权限码，防自我提权）", () => {
        const omnipotentStaff = { ...staffUser, permissions: new Set(["permissions:manage", "orders:view"]) };
        const { guard, ctx } = createContext(omnipotentStaff, undefined, {
            superOnly: { message: "仅超级管理员可调整受保护权限" },
        });
        expect(() => guard.canActivate(ctx)).toThrow(new ForbiddenException("仅超级管理员可调整受保护权限"));
    });

    it("@SuperOnly() 端点：无用户（未认证）403 并携带端点文案", () => {
        const { guard, ctx } = createContext(undefined, undefined, {
            superOnly: { message: "仅超级管理员可操作" },
        });
        expect(() => guard.canActivate(ctx)).toThrow(new ForbiddenException("仅超级管理员可操作"));
    });
});
