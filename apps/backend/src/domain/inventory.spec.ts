import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Tx } from '../prisma/transaction.runner';
import { computeShippableQty, getStockQty } from './inventory';

const stockQuery = /v_bom_stock/;

function createTx(stock: number | null, orders: Array<{ id: bigint; qty: number; outbound_qty: bigint }>) {
    const queryRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = String.raw({ raw: strings.map(String) }, ...values);
        if (stockQuery.test(sql)) {
            return stock === null ? [] : [{ stock_qty: BigInt(stock) }];
        }
        return orders;
    });
    return { tx: { $queryRaw: queryRaw } as unknown as Tx, queryRaw };
}

describe('getStockQty（v_bom_stock）', () => {
    it('有行返回库存，无行返回 0', async () => {
        expect(await getStockQty(createTx(120, []).tx, 5n)).toBe(120);
        expect(await getStockQty(createTx(null, []).tx, 5n)).toBe(0);
    });
});

describe('computeShippableQty（§6.2 分配）', () => {
    const bomId = 1n;

    it('库存充足：目标订单可发量为其剩余欠量', async () => {
        const { tx } = createTx(100, [
            { id: 10n, qty: 30, outbound_qty: 10n },
            { id: 20n, qty: 50, outbound_qty: 0n },
        ]);
        // 前序订单占用 20 后剩 80，目标剩余 50
        await expect(computeShippableQty(tx, { bomId, targetOrderId: 20n, requestedQty: 50 })).resolves.toBe(50);
    });

    it('库存不足：按序分配后剩余多少给多少，请求超出即 409', async () => {
        const { tx } = createTx(25, [
            { id: 10n, qty: 30, outbound_qty: 0n }, // 占用 30？库存仅 25 → 分配后池为 -5（截 0）
            { id: 20n, qty: 50, outbound_qty: 0n },
        ]);
        await expect(computeShippableQty(tx, { bomId, targetOrderId: 20n, requestedQty: 1 })).rejects.toThrow(
            ConflictException,
        );
    });

    it('库存恰够前序订单：目标订单可发 0，任何正数请求 409', async () => {
        const { tx } = createTx(30, [
            { id: 10n, qty: 30, outbound_qty: 0n },
            { id: 20n, qty: 50, outbound_qty: 0n },
        ]);
        await expect(computeShippableQty(tx, { bomId, targetOrderId: 20n, requestedQty: 1 })).rejects.toThrow(
            '库存可发量不足',
        );
    });

    it('目标订单已发满：剩余 0，请求 409', async () => {
        const { tx } = createTx(100, [{ id: 10n, qty: 30, outbound_qty: 30n }]);
        await expect(computeShippableQty(tx, { bomId, targetOrderId: 10n, requestedQty: 1 })).rejects.toThrow(
            ConflictException,
        );
    });

    it('目标订单不在活动列表（不存在/已取消）409', async () => {
        const { tx } = createTx(100, [{ id: 10n, qty: 30, outbound_qty: 0n }]);
        await expect(computeShippableQty(tx, { bomId, targetOrderId: 999n, requestedQty: 1 })).rejects.toThrow(
            '目标订单不存在或已取消',
        );
    });

    it('请求量非正数直接 409', async () => {
        const { tx } = createTx(100, []);
        await expect(computeShippableQty(tx, { bomId, targetOrderId: 10n, requestedQty: 0 })).rejects.toThrow(
            '发货数量必须大于 0',
        );
    });
});
