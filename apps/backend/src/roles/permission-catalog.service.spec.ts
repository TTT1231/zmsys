import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PermissionCatalogService } from "./permission-catalog.service";
import { PrismaService } from "../prisma/prisma.service";
import { TransactionRunner } from "../prisma/transaction.runner";
import { SnowflakeGenerator } from "../common/snowflake";
import type { AuthUser } from "../common/types/auth-user";

const ACTOR: AuthUser = {
    id: "1",
    account: "guojun",
    name: "郭均",
    role: "super",
    isSuper: true,
    rowVersion: 1,
    permissions: new Set(),
};

const PERMISSION = {
    code: "menu:system-logs",
    kind: "MENU" as const,
    menuKey: "system-logs",
    actionId: null,
    label: "系统日志",
    isProtected: true,
};

/** txRunner 直接执行回调，事务客户端即 mock 自身（照 roles.service.spec 款式） */
function createService(permission: unknown, removedCount = 0) {
    const prisma = {
        sysPermission: {
            findUnique: vi.fn().mockResolvedValue(permission),
            update: vi.fn().mockImplementation(async (args: { data: { isProtected: boolean } }) => ({
                ...(permission as object),
                isProtected: args.data.isProtected,
            })),
        },
        sysRole: {
            findMany: vi.fn().mockResolvedValue([{ code: "admin" }, { code: "super" }]),
            updateMany: vi.fn().mockResolvedValue({ count: 5 }),
        },
        sysGrant: { deleteMany: vi.fn().mockResolvedValue({ count: removedCount }) },
        sysPermissionChangeLog: { create: vi.fn().mockResolvedValue({}) },
        $queryRaw: vi.fn().mockResolvedValue([]),
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    } as unknown as PrismaService;
    const snowflake = { next: vi.fn().mockReturnValue(1n) } as unknown as SnowflakeGenerator;
    return {
        service: new PermissionCatalogService(prisma, snowflake, new TransactionRunner(prisma)),
        prisma,
    };
}

describe("PermissionCatalogService.setProtection", () => {
    it("未知权限码返回 404", async () => {
        const { service } = createService(null);
        await expect(service.setProtection("menu:moon", { protected: false }, ACTOR)).rejects.toThrow(
            new NotFoundException("权限不存在"),
        );
    });

    it("受保护状态未变化返回 400 且零写入", async () => {
        const { service, prisma } = createService(PERMISSION);
        await expect(service.setProtection("menu:system-logs", { protected: true }, ACTOR)).rejects.toThrow(
            new BadRequestException("受保护状态未变化"),
        );
        expect(prisma.sysPermission.update).not.toHaveBeenCalled();
        expect(prisma.sysGrant.deleteMany).not.toHaveBeenCalled();
        expect(prisma.sysRole.updateMany).not.toHaveBeenCalled();
        expect(prisma.sysPermissionChangeLog.create).not.toHaveBeenCalled();
    });

    it("解锁：更新标志、不清理授权行、全角色递增 grant_version、写审计日志", async () => {
        const { service, prisma } = createService(PERMISSION);
        const result = await service.setProtection(
            "menu:system-logs",
            { protected: false, reason: "下放给管理员" },
            ACTOR,
        );
        expect(result).toMatchObject({ code: "menu:system-logs", protected: false });
        expect(prisma.sysPermission.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { isProtected: false } }),
        );
        expect(prisma.sysGrant.deleteMany).not.toHaveBeenCalled();
        // 全角色版本递增是 JwtStrategy 权限缓存唯一的失效通道
        expect(prisma.sysRole.updateMany).toHaveBeenCalledWith({ data: { grantVersion: { increment: 1 } } });
        expect(prisma.sysPermissionChangeLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    permissionCode: "menu:system-logs",
                    beforeProtected: true,
                    afterProtected: false,
                    cleanedGrants: 0,
                    reason: "下放给管理员",
                }),
            }),
        );
    });

    it("加锁：同事务清理该码全部授权行并记录清理数", async () => {
        const { service, prisma } = createService({ ...PERMISSION, isProtected: false }, 2);
        const result = await service.setProtection("menu:system-logs", { protected: true }, ACTOR);
        expect(result).toMatchObject({ code: "menu:system-logs", protected: true });
        expect(prisma.sysGrant.deleteMany).toHaveBeenCalledWith({ where: { permissionCode: "menu:system-logs" } });
        expect(prisma.sysPermissionChangeLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ beforeProtected: false, afterProtected: true, cleanedGrants: 2 }),
            }),
        );
    });
});

describe("PermissionCatalogService.listChangeLogs", () => {
    it("拼装操作人/权限名/原因的审计文案", async () => {
        const prisma = {
            sysPermissionChangeLog: {
                findMany: vi.fn().mockResolvedValue([
                    {
                        id: 2n,
                        operatorId: 1n,
                        permissionCode: "menu:system-logs",
                        beforeProtected: true,
                        afterProtected: false,
                        cleanedGrants: 0,
                        reason: "下放给管理员",
                        createdAt: new Date("2026-10-10T02:00:00Z"),
                    },
                ]),
            },
            sysUser: { findMany: vi.fn().mockResolvedValue([{ id: 1n, name: "郭均" }]) },
            sysPermission: { findMany: vi.fn().mockResolvedValue([{ code: "menu:system-logs", label: "系统日志" }]) },
            $transaction: vi.fn(),
        } as unknown as PrismaService;
        const service = new PermissionCatalogService(
            prisma,
            {} as unknown as SnowflakeGenerator,
            new TransactionRunner(prisma),
        );
        const logs = await service.listChangeLogs();
        expect(logs).toHaveLength(1);
        expect(logs[0].user).toBe("郭均");
        expect(logs[0].text).toBe("权限【系统日志】已解锁，可授予其他角色；原因：下放给管理员");
    });
});
