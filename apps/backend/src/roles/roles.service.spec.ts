import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RolesService } from './roles.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionRunner } from '../prisma/transaction.runner';
import { SnowflakeGenerator } from '../common/snowflake';
import type { AuthUser } from '../common/types/auth-user';

/** 权限目录最小切片：普通菜单/动作 + 受保护菜单/动作 */
const CATALOG = [
    {
        code: 'menu:orders',
        kind: 'MENU',
        menuKey: 'orders',
        actionId: null,
        label: '销售订单',
        isProtected: false,
    },
    {
        code: 'menu:inbound',
        kind: 'MENU',
        menuKey: 'inbound',
        actionId: null,
        label: '成品入库',
        isProtected: false,
    },
    {
        code: 'menu:permissions',
        kind: 'MENU',
        menuKey: 'permissions',
        actionId: null,
        label: '用户与权限',
        isProtected: true,
    },
    {
        code: 'orders:view',
        kind: 'ACTION',
        menuKey: 'orders',
        actionId: 'view',
        label: '查看',
        isProtected: false,
    },
    {
        code: 'orders:create',
        kind: 'ACTION',
        menuKey: 'orders',
        actionId: 'create',
        label: '新建订单',
        isProtected: false,
    },
    {
        code: 'inbound:view',
        kind: 'ACTION',
        menuKey: 'inbound',
        actionId: 'view',
        label: '查看台账',
        isProtected: false,
    },
    {
        code: 'permissions:view',
        kind: 'ACTION',
        menuKey: 'permissions',
        actionId: 'view',
        label: '查看',
        isProtected: true,
    },
];

const ACTOR: AuthUser = {
    id: '1',
    account: 'guojun',
    name: '郭均',
    role: 'super',
    isSuper: true,
    rowVersion: 1,
    permissions: new Set(),
};

function createService(options?: { grantVersion?: bigint }) {
    const grantVersion = options?.grantVersion ?? 1n;
    const prisma = {
        sysPermission: { findMany: vi.fn().mockResolvedValue(CATALOG) },
        sysRole: {
            findUnique: vi.fn().mockResolvedValue({ code: 'admin', name: '管理员', grantVersion }),
            update: vi.fn().mockResolvedValue({
                code: 'admin',
                name: '管理员',
                grantVersion: grantVersion + 1n,
            }),
        },
        sysGrant: {
            findMany: vi.fn().mockResolvedValue([]),
            deleteMany: vi.fn().mockResolvedValue(0),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        sysGrantLog: { create: vi.fn().mockResolvedValue({}) },
        $queryRaw: vi.fn().mockResolvedValue([]),
        // $transaction 直接执行回调，事务客户端即 mock 自身
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    } as unknown as PrismaService;
    const snowflake = { next: vi.fn().mockReturnValue(1n) } as unknown as SnowflakeGenerator;
    return { service: new RolesService(prisma, snowflake, new TransactionRunner(prisma)), prisma, snowflake };
}

function saveInput(overrides: Record<string, unknown> = {}) {
    return {
        grant: { version: 1, menus: ['orders'], actions: { orders: ['view'] } },
        expectedVersion: 1,
        note: '',
        ...overrides,
    } as Parameters<RolesService['saveGrant']>[1];
}

describe('RolesService.saveGrant', () => {
    let service: RolesService;

    beforeEach(() => {
        ({ service } = createService());
    });

    it('未知角色返回 404', async () => {
        await expect(service.saveGrant('hacker', saveInput(), ACTOR)).rejects.toThrow(
            new NotFoundException('角色不存在'),
        );
    });

    it('内置 super 角色授权不可修改，返回 403', async () => {
        await expect(service.saveGrant('super', saveInput(), ACTOR)).rejects.toThrow(
            new ForbiddenException('超级管理员为内置角色，授权不可修改'),
        );
    });

    it('未知菜单返回 400', async () => {
        await expect(
            service.saveGrant('admin', saveInput({ grant: { version: 1, menus: ['moon'], actions: {} } }), ACTOR),
        ).rejects.toThrow(new BadRequestException('授权中包含未知菜单'));
    });

    it('受保护菜单授予普通角色返回 400', async () => {
        await expect(
            service.saveGrant(
                'admin',
                saveInput({
                    grant: { version: 1, menus: ['permissions'], actions: {} },
                }),
                ACTOR,
            ),
        ).rejects.toThrow(new BadRequestException('受保护的用户与权限菜单只能由超级管理员持有'));
    });

    it('受保护动作授予普通角色返回 400', async () => {
        await expect(
            service.saveGrant(
                'admin',
                saveInput({
                    grant: {
                        version: 1,
                        menus: ['orders'],
                        actions: { orders: ['view'], permissions: ['view'] },
                    },
                }),
                ACTOR,
            ),
        ).rejects.toThrow(new BadRequestException('受保护权限只能由超级管理员持有'));
    });

    it('动作缺少父菜单或 view 时返回 400', async () => {
        await expect(
            service.saveGrant(
                'admin',
                saveInput({
                    grant: {
                        version: 1,
                        menus: ['inbound'],
                        actions: { orders: ['view'] },
                    },
                }),
                ACTOR,
            ),
        ).rejects.toThrow(new BadRequestException('操作权限必须同时包含父菜单和查看权限'));

        await expect(
            service.saveGrant(
                'admin',
                saveInput({
                    grant: {
                        version: 1,
                        menus: ['orders'],
                        actions: { orders: ['create'] },
                    },
                }),
                ACTOR,
            ),
        ).rejects.toThrow(new BadRequestException('操作权限必须同时包含父菜单和查看权限'));
    });

    it('乐观锁版本不匹配返回 409', async () => {
        ({ service } = createService({ grantVersion: 2n }));
        await expect(service.saveGrant('admin', saveInput({ expectedVersion: 1 }), ACTOR)).rejects.toThrow(
            new ConflictException('角色授权已被其他人修改，请刷新后重试'),
        );
    });

    it('合法保存返回新版本授权并整组替换', async () => {
        const { prisma } = createService();
        const result = await new RolesService(
            prisma,
            { next: () => 1n } as unknown as SnowflakeGenerator,
            new TransactionRunner(prisma),
        ).saveGrant(
            'admin',
            saveInput({
                grant: {
                    version: 1,
                    menus: ['orders'],
                    actions: { orders: ['view', 'create'] },
                },
            }),
            ACTOR,
        );
        expect(result.version).toBe(2);
        expect(result.menus).toEqual(['orders']);
        // actions 按 menuKey 分组，顺序来自权限码排序，前端只做 includes 判断
        expect(result.actions.orders).toEqual(['create', 'view']);
        expect(prisma.sysGrant.deleteMany).toHaveBeenCalled();
        expect(prisma.sysGrantLog.create).toHaveBeenCalled();
    });
});
