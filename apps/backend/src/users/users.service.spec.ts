import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionRunner } from '../prisma/transaction.runner';
import { SnowflakeGenerator } from '../common/snowflake';
import { IdempotencyService } from '../idempotency/idempotency.service';
import type { SysUser, CustomTable } from '../generated/prisma/client';

const actor = {
    id: '1',
    account: 'guojun',
    name: '郭均',
    role: 'super',
    isSuper: true,
    rowVersion: 1,
    permissions: new Set<string>(),
} as const;

const mkUser = (overrides: Partial<SysUser>): SysUser =>
    ({
        id: 1n,
        account: 'guojun',
        name: '郭均',
        roleCode: 'super',
        status: true,
        tokenVersion: 1n,
        rowVersion: 1n,
        passwordHash: bcrypt.hashSync('123456', 4),
        passwordChangedAt: null,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    }) as SysUser;

interface Store {
    users: Map<string, SysUser>;
    customers: CustomTable[];
    userLogs: unknown[];
    ownerHistories: unknown[];
}

/**
 * 内存版事务客户端：直通实现 service 触碰的 Prisma 面，
 * $transaction 由真实 TransactionRunner 调用并以同一 tx 对象回调。
 */
const createStore = (store: Store) => {
    const tx = {
        $queryRaw: vi.fn(),
        sysUser: {
            findUnique: vi.fn(async ({ where }: { where: { account?: string; id?: bigint } }) =>
                where.account
                    ? (store.users.get(where.account) ?? null)
                    : ([...store.users.values()].find(u => u.id === where.id) ?? null),
            ),
            findMany: vi.fn(async () => [...store.users.values()]),
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                const user = mkUser({
                    ...data,
                    id: data.id as bigint,
                    account: data.account as string,
                } as Partial<SysUser>);
                store.users.set(user.account, user);
                return user;
            }),
            update: vi.fn(async ({ where, data }: { where: { id: bigint }; data: Record<string, unknown> }) => {
                const user = [...store.users.values()].find(item => item.id === where.id);
                if (!user) {
                    throw new Error('update: 用户不存在');
                }
                const applied = { ...user, ...data } as SysUser;
                // { increment: 1 } 形态字段按增量语义落地
                for (const key of ['tokenVersion', 'rowVersion'] as const) {
                    const patch = data[key] as { increment: number } | undefined;
                    if (patch) {
                        applied[key] = user[key] + BigInt(patch.increment);
                    }
                }
                store.users.set(user.account, applied);
                return applied;
            }),
        },
        sysUserChangeLog: {
            create: vi.fn(async ({ data }: { data: unknown }) => {
                store.userLogs.push(data);
                return data;
            }),
        },
        customTable: {
            count: vi.fn(
                async ({ where }: { where: { ownerId: bigint } }) =>
                    store.customers.filter(customer => customer.ownerId === where.ownerId).length,
            ),
            findMany: vi.fn(async ({ where }: { where: { ownerId: bigint } }) =>
                store.customers.filter(customer => customer.ownerId === where.ownerId),
            ),
            update: vi.fn(async ({ where, data }: { where: { id: bigint }; data: Record<string, unknown> }) => {
                const customer = store.customers.find(item => item.id === where.id);
                if (!customer) {
                    throw new Error('update: 客户不存在');
                }
                Object.assign(customer, data, { rowVersion: customer.rowVersion + 1n });
                return customer;
            }),
        },
        customerOwnerHistory: {
            create: vi.fn(async ({ data }: { data: unknown }) => {
                store.ownerHistories.push(data);
                return data;
            }),
        },
    };
    // TransactionRunner 持有 $transaction 并以 tx 回调业务方法；同一对象兼任 prisma 与 tx
    return Object.assign(tx, {
        $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    });
};

const mkService = (store: Store, beginOrReplay?: ReturnType<typeof vi.fn>) => {
    const tx = createStore(store);
    const prisma = { $transaction: tx.$transaction, sysUser: tx.sysUser } as unknown as PrismaService;
    const snowflake = { next: vi.fn(() => 9000000000000000n) } as unknown as SnowflakeGenerator;
    const idempotency = {
        requireKey: vi.fn((key?: string) => {
            if (!key || key.length < 8) {
                throw new BadRequestException('Idempotency-Key 必须为 8–128 个可见 ASCII 字符');
            }
            return key;
        }),
        digest: vi.fn(() => new Uint8Array(32)),
        beginOrReplay: beginOrReplay ?? vi.fn(async () => ({ replay: null, placeholderId: 8000000000000000n })),
        complete: vi.fn(),
    } as unknown as IdempotencyService & Record<string, ReturnType<typeof vi.fn>>;
    return {
        service: new UsersService(prisma, snowflake, new TransactionRunner(prisma), idempotency),
        tx,
        idempotency,
        store,
    };
};

const ID_KEY = 'idem-key-01';
const mkCustomer = (id: bigint, ownerId: bigint): CustomTable =>
    ({
        id,
        customerCode: `CUS-${id}`,
        name: `客户${id}`,
        contactPerson: '联系人',
        contactPhone: '13800000000',
        province: '广东省',
        city: '深圳市',
        district: null,
        town: null,
        address: '地址',
        ownerId,
        payTerms: '',
        rowVersion: 1n,
        requestKey: `req-${id}`,
        createdBy: 1n,
        updatedBy: 1n,
        createdAt: new Date(),
        updatedAt: new Date(),
    }) as CustomTable;

describe('UsersService.listUsers', () => {
    it('映射为 WbUser，从未登录显示破折号', async () => {
        const store: Store = {
            users: new Map([
                ['guojun', mkUser({ id: 1n })],
                ['sales01', mkUser({ id: 200n, account: 'sales01', roleCode: 'sales', lastLoginAt: new Date() })],
            ]),
            customers: [],
            userLogs: [],
            ownerHistories: [],
        };
        const { service } = mkService(store);
        const users = await service.listUsers();
        expect(users).toHaveLength(2);
        expect(users[0]).toMatchObject({ account: 'guojun', role: 'super', active: true, last: '—' });
        expect(users[1]).toMatchObject({ account: 'sales01', role: 'sales' });
        expect(users[1].last).not.toBe('—');
    });
});

describe('UsersService.createUser', () => {
    let store: Store;
    let ctx: ReturnType<typeof mkService>;

    beforeEach(() => {
        store = { users: new Map(), customers: [], userLogs: [], ownerHistories: [] };
        ctx = mkService(store);
    });

    it('创建成功：初始密码 123456 强哈希、写 CREATE 日志、登记幂等响应', async () => {
        const created = await ctx.service.createUser(
            { name: '王仓管', account: 'wang_wh', role: 'warehouse' },
            actor,
            ID_KEY,
        );
        expect(created).toMatchObject({ account: 'wang_wh', role: 'warehouse', active: true, last: '—' });
        const stored = store.users.get('wang_wh');
        expect(stored).toBeDefined();
        expect(await bcrypt.compare('123456', stored!.passwordHash)).toBe(true);
        expect(store.userLogs).toHaveLength(1);
        expect(store.userLogs[0]).toMatchObject({ eventType: 'CREATE', reason: expect.not.stringContaining('123456') });
        expect(ctx.idempotency.complete).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                httpStatus: 200,
                resource: { type: 'user', code: 'wang_wh' },
            }),
        );
    });

    it('账号已存在返回 409', async () => {
        store.users.set('wang_wh', mkUser({ account: 'wang_wh' }));
        await expect(
            ctx.service.createUser({ name: '王仓管', account: 'wang_wh', role: 'warehouse' }, actor, ID_KEY),
        ).rejects.toThrow(new ConflictException('账号已存在'));
    });

    it('幂等键非法返回 400，不触碰数据库', async () => {
        await expect(
            ctx.service.createUser({ name: '王仓管', account: 'wang_wh', role: 'warehouse' }, actor, 'short'),
        ).rejects.toThrow(BadRequestException);
        expect(ctx.tx.sysUser.create).not.toHaveBeenCalled();
    });

    it('重放既有成功响应：直接返回快照数据，不再创建用户', async () => {
        const replayBody = {
            version: 1,
            name: '王仓管',
            account: 'wang_wh',
            role: 'warehouse',
            active: true,
            last: '—',
        };
        const local = mkService(
            store,
            vi.fn(async () => ({ replay: { httpStatus: 200, body: replayBody }, placeholderId: null })),
        );
        const result = await local.service.createUser(
            { name: '王仓管', account: 'wang_wh', role: 'warehouse' },
            actor,
            ID_KEY,
        );
        expect(result).toEqual(replayBody);
        expect(local.tx.sysUser.create).not.toHaveBeenCalled();
        expect(local.idempotency.complete).not.toHaveBeenCalled();
    });
});

describe('UsersService.updateUser', () => {
    it('用户不存在返回 404', async () => {
        const { service } = mkService({ users: new Map(), customers: [], userLogs: [], ownerHistories: [] });
        await expect(
            service.updateUser('nobody', { expectedVersion: 1, name: '新人', role: 'staff' }, actor),
        ).rejects.toThrow(new NotFoundException('用户不存在'));
    });

    it('乐观锁版本不匹配返回 409', async () => {
        const sales = mkUser({ id: 200n, account: 'sales01', roleCode: 'sales', rowVersion: 3n });
        const { service } = mkService({
            users: new Map([['sales01', sales]]),
            customers: [],
            userLogs: [],
            ownerHistories: [],
        });
        await expect(
            service.updateUser('sales01', { expectedVersion: 1, name: '销售一', role: 'sales' }, actor),
        ).rejects.toThrow(ConflictException);
    });

    it('super 的角色不可修改，也不得把 super 授予普通用户', async () => {
        const superUser = mkUser({});
        const clerk = mkUser({ id: 100n, account: 'clerk', roleCode: 'staff' });
        const { service } = mkService({
            users: new Map([
                ['guojun', superUser],
                ['clerk', clerk],
            ]),
            customers: [],
            userLogs: [],
            ownerHistories: [],
        });
        await expect(
            service.updateUser('guojun', { expectedVersion: 1, name: '郭均', role: 'admin' }, actor),
        ).rejects.toThrow(new BadRequestException('内置超级管理员角色不可修改'));
        await expect(
            service.updateUser('clerk', { expectedVersion: 1, name: '职员', role: 'super' }, actor),
        ).rejects.toThrow(new BadRequestException('不得通过接口授予超级管理员角色'));
    });

    it('仅改姓名：版本 +1、tokenVersion 不变、记 PROFILE_UPDATE', async () => {
        const clerk = mkUser({ id: 100n, account: 'clerk', roleCode: 'staff' });
        const store: Store = { users: new Map([['clerk', clerk]]), customers: [], userLogs: [], ownerHistories: [] };
        const { service } = mkService(store);
        const updated = await service.updateUser('clerk', { expectedVersion: 1, name: '职员甲', role: 'staff' }, actor);
        expect(updated).toMatchObject({ name: '职员甲', version: 2 });
        expect(store.users.get('clerk')!.tokenVersion).toBe(1n);
        expect(store.userLogs[0]).toMatchObject({ eventType: 'PROFILE_UPDATE' });
    });

    it('销售转岗仍有客户且未指定接任人返回 400', async () => {
        const sales = mkUser({ id: 200n, account: 'sales01', roleCode: 'sales' });
        const store: Store = {
            users: new Map([['sales01', sales]]),
            customers: [mkCustomer(900n, 200n)],
            userLogs: [],
            ownerHistories: [],
        };
        const { service } = mkService(store);
        await expect(
            service.updateUser('sales01', { expectedVersion: 1, name: '销售一', role: 'staff' }, actor),
        ).rejects.toThrow(new BadRequestException('该销售仍负责 1 个客户，必须指定接任销售并填写移交原因'));
    });

    it('销售转岗：同事务批量移交客户、递增 tokenVersion、写 ROLE_CHANGE 与移交历史', async () => {
        const sales = mkUser({ id: 200n, account: 'sales01', roleCode: 'sales' });
        const next = mkUser({ id: 300n, account: 'sales02', roleCode: 'sales' });
        const store: Store = {
            users: new Map([
                ['sales01', sales],
                ['sales02', next],
            ]),
            customers: [mkCustomer(900n, 200n), mkCustomer(901n, 200n)],
            userLogs: [],
            ownerHistories: [],
        };
        const { service } = mkService(store);
        const updated = await service.updateUser(
            'sales01',
            {
                expectedVersion: 1,
                name: '销售一',
                role: 'admin',
                replacementOwnerAccount: 'sales02',
                transferReason: '转岗移交',
            },
            actor,
        );
        expect(updated).toMatchObject({ role: 'admin', version: 2 });
        expect(store.users.get('sales01')!.tokenVersion).toBe(2n);
        expect(store.customers.map(customer => customer.ownerId)).toEqual([300n, 300n]);
        expect(store.customers.every(customer => customer.rowVersion === 2n)).toBe(true);
        // 同一批次共用 batchId，逐客户一行历史
        expect(store.ownerHistories).toHaveLength(2);
        const batchIds = new Set(store.ownerHistories.map(item => (item as { batchId: bigint }).batchId));
        expect(batchIds.size).toBe(1);
        expect(store.userLogs[0]).toMatchObject({ eventType: 'ROLE_CHANGE' });
    });

    it('接任人不是启用中的其他销售返回 400', async () => {
        const sales = mkUser({ id: 200n, account: 'sales01', roleCode: 'sales' });
        const clerk = mkUser({ id: 100n, account: 'clerk', roleCode: 'staff' });
        const store: Store = {
            users: new Map([
                ['sales01', sales],
                ['clerk', clerk],
            ]),
            customers: [mkCustomer(900n, 200n)],
            userLogs: [],
            ownerHistories: [],
        };
        const { service } = mkService(store);
        await expect(
            service.updateUser(
                'sales01',
                {
                    expectedVersion: 1,
                    name: '销售一',
                    role: 'staff',
                    replacementOwnerAccount: 'clerk',
                    transferReason: '转岗移交',
                },
                actor,
            ),
        ).rejects.toThrow(new BadRequestException('接任销售必须是启用中的其他销售账号'));
    });
});

describe('UsersService.setUserStatus', () => {
    it('super 不可停用', async () => {
        const superUser = mkUser({});
        const { service } = mkService({
            users: new Map([['guojun', superUser]]),
            customers: [],
            userLogs: [],
            ownerHistories: [],
        });
        await expect(service.setUserStatus('guojun', { expectedVersion: 1, active: false }, actor)).rejects.toThrow(
            new BadRequestException('内置超级管理员不可停用'),
        );
    });

    it('停用递增 tokenVersion 与 rowVersion 并写 STATUS_CHANGE；重复停用幂等返回现状', async () => {
        const clerk = mkUser({ id: 100n, account: 'clerk', roleCode: 'staff' });
        const store: Store = { users: new Map([['clerk', clerk]]), customers: [], userLogs: [], ownerHistories: [] };
        const { service } = mkService(store);
        const disabled = await service.setUserStatus('clerk', { expectedVersion: 1, active: false }, actor);
        expect(disabled).toMatchObject({ active: false, version: 2 });
        expect(store.users.get('clerk')!.tokenVersion).toBe(2n);
        expect(store.userLogs[0]).toMatchObject({ eventType: 'STATUS_CHANGE' });

        const noop = await service.setUserStatus('clerk', { expectedVersion: 2, active: false }, actor);
        expect(noop.version).toBe(2);
        expect(store.userLogs).toHaveLength(1);
    });

    it('停用仍负责客户的销售必须原子移交', async () => {
        const sales = mkUser({ id: 200n, account: 'sales01', roleCode: 'sales' });
        const next = mkUser({ id: 300n, account: 'sales02', roleCode: 'sales' });
        const store: Store = {
            users: new Map([
                ['sales01', sales],
                ['sales02', next],
            ]),
            customers: [mkCustomer(900n, 200n)],
            userLogs: [],
            ownerHistories: [],
        };
        const { service } = mkService(store);
        const disabled = await service.setUserStatus(
            'sales01',
            { expectedVersion: 1, active: false, replacementOwnerAccount: 'sales02', transferReason: '休假移交' },
            actor,
        );
        expect(disabled).toMatchObject({ active: false });
        expect(store.customers[0].ownerId).toBe(300n);
        expect(store.ownerHistories).toHaveLength(1);
    });

    it('重新启用不递增 tokenVersion（旧 JWT 仍失效，需重新登录）', async () => {
        const clerk = mkUser({ id: 100n, account: 'clerk', roleCode: 'staff', status: false, tokenVersion: 5n });
        const store: Store = { users: new Map([['clerk', clerk]]), customers: [], userLogs: [], ownerHistories: [] };
        const { service } = mkService(store);
        const enabled = await service.setUserStatus('clerk', { expectedVersion: 1, active: true }, actor);
        expect(enabled).toMatchObject({ active: true, version: 2 });
        expect(store.users.get('clerk')!.tokenVersion).toBe(5n);
    });
});
