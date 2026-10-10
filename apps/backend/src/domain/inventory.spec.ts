import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma/transaction.runner";
import { computeShippableQty, getStockQty } from "./inventory";

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

describe("getStockQty（v_bom_stock）", () => {
    it("有行返回库存，无行返回 0", async () => {
        expect(await getStockQty(createTx(120, []).tx, 5n)).toBe(120);
        expect(await getStockQty(createTx(null, []).tx, 5n)).toBe(0);
    });
});

describe("computeShippableQty（§6.2 桶模型）", () => {
    const bomId = 1n;

    it("库存充足：目标订单可发量为其剩余欠量", async () => {
        const { tx } = createTx(100, [
            { id: 10n, qty: 30, outbound_qty: 10n },
            { id: 20n, qty: 50, outbound_qty: 0n },
        ]);
        // 桶模型：其他订单的剩余量不占用库存，目标剩余 50、库存 100
        await expect(computeShippableQty(tx, { bomId, targetOrderId: 20n, requestedQty: 50 })).resolves.toBe(50);
    });

    it("桶模型核心：其他订单剩余不挤占目标可发量，库存够就能发", async () => {
        const { tx } = createTx(25, [
            { id: 10n, qty: 30, outbound_qty: 0n },
            { id: 20n, qty: 50, outbound_qty: 0n },
        ]);
        // 旧排队模型此场景前序订单吃满池子；桶模型下目标可发 = min(25, 50) = 25
        await expect(computeShippableQty(tx, { bomId, targetOrderId: 20n, requestedQty: 25 })).resolves.toBe(25);
    });

    it("库存不足：可发量为库存，请求超出即 409", async () => {
        const { tx } = createTx(25, [
            { id: 10n, qty: 30, outbound_qty: 0n },
            { id: 20n, qty: 50, outbound_qty: 0n },
        ]);
        await expect(computeShippableQty(tx, { bomId, targetOrderId: 20n, requestedQty: 26 })).rejects.toThrow(
            "库存可发量不足",
        );
    });

    it("库存为 0：任何正数请求 409", async () => {
        const { tx } = createTx(0, [{ id: 20n, qty: 50, outbound_qty: 0n }]);
        await expect(computeShippableQty(tx, { bomId, targetOrderId: 20n, requestedQty: 1 })).rejects.toThrow(
            "库存可发量不足",
        );
    });

    it("请求量超过本单剩余待交：409（不得超订单数量）", async () => {
        const { tx } = createTx(100, [{ id: 10n, qty: 30, outbound_qty: 10n }]);
        await expect(computeShippableQty(tx, { bomId, targetOrderId: 10n, requestedQty: 21 })).rejects.toThrow(
            "库存可发量不足",
        );
    });

    it("目标订单已发满：剩余 0，请求 409", async () => {
        const { tx } = createTx(100, [{ id: 10n, qty: 30, outbound_qty: 30n }]);
        await expect(computeShippableQty(tx, { bomId, targetOrderId: 10n, requestedQty: 1 })).rejects.toThrow(
            ConflictException,
        );
    });

    it("目标订单不在活动列表（不存在/已取消）409", async () => {
        const { tx } = createTx(100, [{ id: 10n, qty: 30, outbound_qty: 0n }]);
        await expect(computeShippableQty(tx, { bomId, targetOrderId: 999n, requestedQty: 1 })).rejects.toThrow(
            "目标订单不存在或已取消",
        );
    });

    it("请求量非正数直接 409", async () => {
        const { tx } = createTx(100, []);
        await expect(computeShippableQty(tx, { bomId, targetOrderId: 10n, requestedQty: 0 })).rejects.toThrow(
            "发货数量必须大于 0",
        );
    });
});
