import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import type { SnowflakeGenerator } from '../common/snowflake';
import type { Tx } from '../prisma/transaction.runner';
import { recordOpLog } from './op-log';

const operator = { id: '7', name: '测试员工', role: 'staff' as const };
const snowflake = { next: () => 9001n } as unknown as SnowflakeGenerator;
const now = new Date('2026-09-12T02:00:00.000Z');

function createTx() {
    const create = vi.fn().mockResolvedValue({});
    return { tx: { opLog: { create } } as unknown as Tx, create };
}

const prismaKnownError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('prisma error', { code, clientVersion: 'test' });

describe('recordOpLog（同事务里程碑审计）', () => {
    it('写入姓名/角色快照与业务标识，时间由调用方传入', async () => {
        const { tx, create } = createTx();
        await recordOpLog(tx, snowflake, operator, {
            action: 'create_order',
            targetType: 'sales_order_table',
            targetId: 500n,
            targetCode: 'ZM260912001',
            detail: { qty: 10 },
            now,
        });
        expect(create).toHaveBeenCalledWith({
            data: {
                id: 9001n,
                operatorId: 7n,
                operatorNameSnapshot: '测试员工',
                operatorRoleSnapshot: 'staff',
                action: 'create_order',
                targetType: 'sales_order_table',
                targetId: 500n,
                targetCode: 'ZM260912001',
                detailJson: { qty: 10 },
                createdAt: now,
            },
        });
    });

    it('uk(action, target_id) 冲突（该目标已记录过）静默跳过', async () => {
        const { tx, create } = createTx();
        create.mockRejectedValue(prismaKnownError('P2002'));
        await expect(
            recordOpLog(tx, snowflake, operator, {
                action: 'ship',
                targetType: 'outbound_shipment',
                targetId: 600n,
                targetCode: 'CK26091201',
                detail: {},
                now,
            }),
        ).resolves.toBeUndefined();
    });

    it('其他数据库错误原样抛出', async () => {
        const { tx, create } = createTx();
        create.mockRejectedValue(prismaKnownError('P2003'));
        await expect(
            recordOpLog(tx, snowflake, operator, {
                action: 'ship',
                targetType: 'outbound_shipment',
                targetId: 600n,
                targetCode: 'CK26091201',
                detail: {},
                now,
            }),
        ).rejects.toThrow();
    });
});
