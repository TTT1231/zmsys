import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service";
import { AiAgentService } from "./ai-agent.service";

describe("AI 作废出库筛选", () => {
    it.each([{ orderNo: "ORDER_A", bomCode: "BOM_B" }, { orderNo: "ORDER_A" }, { bomCode: "BOM_B" }])(
        "明细与总数同时保留所有筛选条件：%j",
        async query => {
            const findMany = vi.fn().mockResolvedValue([]);
            const count = vi.fn().mockResolvedValue(0);
            const prisma = {
                outboundShipment: { findMany, count },
                $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
            } as unknown as PrismaService;
            const service = new AiAgentService(prisma);
            await service.listVoidedOutbound({ ...query, keyword: "SHIP", limit: 100 });
            const expected = {
                state: "VOIDED",
                order: {
                    ...(query.orderNo ? { orderNo: query.orderNo } : {}),
                    ...(query.bomCode ? { bom: { bomCode: query.bomCode } } : {}),
                },
            };
            expect(findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining(expected) }),
            );
            expect(count).toHaveBeenCalledWith({ where: findMany.mock.calls[0]![0].where });
        },
    );
});
