import { describe, expect, it, vi } from "vitest";
import { LedgerPurgeService } from "./ledger-purge.service";
import { PrismaService } from "../prisma/prisma.service";
import { TransactionRunner } from "../prisma/transaction.runner";
import { MaintenanceState } from "../domain/maintenance-state";

/* 手写假件：$queryRaw 按批次队列返回候选 id；deleteMany 记录调用序列供顺序断言 */

const ids = (...values: number[]) => values.map(value => BigInt(value));

const mkService = (inboundBatches: bigint[][], outboundBatches: bigint[][], orderBatches: bigint[][] = [[]]) => {
    const ops: Array<{ model: string; where: Record<string, unknown> }> = [];
    const tx = {
        inboundChangeLog: {
            deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
                ops.push({ model: "inboundChangeLog", where });
            }),
        },
        inboundLedger: {
            deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
                ops.push({ model: "inboundLedger", where });
            }),
        },
        outboundStateLog: {
            deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
                ops.push({ model: "outboundStateLog", where });
            }),
        },
        outboundLedger: {
            deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
                ops.push({ model: "outboundLedger", where });
            }),
        },
        outboundShipment: {
            deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
                ops.push({ model: "outboundShipment", where });
            }),
        },
        salesOrderChangeLog: {
            deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
                ops.push({ model: "salesOrderChangeLog", where });
            }),
        },
        salesOrderTable: {
            deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
                ops.push({ model: "salesOrderTable", where });
            }),
        },
    };
    const queryRaw = vi.fn(async (sql: unknown) => {
        const isTemplate = Array.isArray(sql);
        const strings = isTemplate
            ? (sql as readonly string[])
            : ((sql as { strings?: readonly string[] }).strings ?? []);
        const text = strings.join("");
        const queue = text.includes("inbound_ledger")
            ? inboundBatches
            : text.includes("sales_order_table")
              ? orderBatches
              : outboundBatches;
        // 每次查询消费一个批次；队列耗尽返回空（查空即退出）
        const batch = queue.shift() ?? [];
        return batch.map(id => ({ id }));
    });
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    const txRunner = {
        run: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as TransactionRunner;
    const maintenance = new MaintenanceState();
    return { service: new LedgerPurgeService(prisma, txRunner, maintenance), ops, queryRaw, maintenance };
};

describe("LedgerPurgeService.purge", () => {
    it("入库：变更日志先删、台账行后删；分批推进至查空退出；返回累计行数", async () => {
        const { service, ops } = mkService([ids(1, 2), ids(3), []], [[]]);
        const counts = await service.purge(new Date(0));
        expect(counts).toEqual({ inbound: 3, outbound: 0, orders: 0 });
        // 每批顺序：先 inboundChangeLog 后 inboundLedger
        expect(ops.map(op => op.model)).toEqual([
            "inboundChangeLog",
            "inboundLedger",
            "inboundChangeLog",
            "inboundLedger",
        ]);
        expect(ops[0]!.where).toEqual({ inboundId: { in: ids(1, 2) } });
        expect(ops[1]!.where).toEqual({ id: { in: ids(1, 2) } });
    });

    it("出库：状态日志 → CORRECTION 冲销行 → NORMAL 正向行 → 单头，顺序不变（自引用外键）", async () => {
        const { service, ops } = mkService([[]], [ids(10, 11)]);
        const counts = await service.purge(new Date(0));
        expect(counts.outbound).toBe(2);
        expect(ops.map(op => op.model)).toEqual([
            "outboundStateLog",
            "outboundLedger",
            "outboundLedger",
            "outboundShipment",
        ]);
        const corrections = ops.find(op => op.model === "outboundLedger" && op.where.correctionOfId);
        expect(corrections!.where).toEqual({
            shipmentId: { in: ids(10, 11) },
            correctionOfId: { not: null },
        });
    });

    it("无候选时零删除零事务（查空即退出，不空转）", async () => {
        const { service, ops } = mkService([[]], [[]]);
        const counts = await service.purge(new Date(0));
        expect(counts).toEqual({ inbound: 0, outbound: 0, orders: 0 });
        expect(ops).toHaveLength(0);
    });

    it("订单：关联出库清理后，先删变更日志再删订单", async () => {
        const { service, ops } = mkService([[]], [[]], [ids(20), []]);
        const counts = await service.purge(new Date(0));
        expect(counts).toEqual({ inbound: 0, outbound: 0, orders: 1 });
        expect(ops.map(op => op.model)).toEqual(["salesOrderChangeLog", "salesOrderTable"]);
        expect(ops[0]!.where).toEqual({ orderId: { in: ids(20) } });
    });
});
