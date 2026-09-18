import { describe, expect, it, vi } from "vitest";
import { BusinessSequenceService } from "./business-sequence.service";
import type { Tx } from "../prisma/transaction.runner";

function createService() {
    const service = new BusinessSequenceService();
    const executeRaw = vi.fn().mockResolvedValue(1);
    const queryRaw = vi.fn().mockResolvedValue([{ next_value: 5n }]);
    const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw } as unknown as Tx;
    return { service, executeRaw, queryRaw, tx };
}

describe("BusinessSequenceService.nextCode（契约编码格式化）", () => {
    it("订单：ZM + yyMMdd + 至少 3 位序号", async () => {
        const { service, queryRaw, tx } = createService();
        queryRaw.mockResolvedValue([{ next_value: 1n }]);
        await expect(service.nextCode(tx, "order", "2026-09-11")).resolves.toBe("ZM260911001");
        queryRaw.mockResolvedValue([{ next_value: 12n }]);
        await expect(service.nextCode(tx, "order", "2026-09-11")).resolves.toBe("ZM260911012");
    });

    it("序号超宽自然增长不截断（1000 仍为四位显示）", async () => {
        const { service, queryRaw, tx } = createService();
        queryRaw.mockResolvedValue([{ next_value: 1000n }]);
        await expect(service.nextCode(tx, "order", "2026-09-11")).resolves.toBe("ZM2609111000");
    });

    it("入库/出库：RK/CK + yyMMdd + 至少 2 位序号；调整：TZ- + yyyyMMdd + 至少 4 位（与 mock 同构带连字符）", async () => {
        const { service, queryRaw, tx } = createService();
        queryRaw.mockResolvedValue([{ next_value: 7n }]);
        await expect(service.nextCode(tx, "inbound", "2026-09-11")).resolves.toBe("RK26091107");
        await expect(service.nextCode(tx, "outbound", "2026-09-11")).resolves.toBe("CK26091107");
        await expect(service.nextCode(tx, "adjust", "2026-09-11")).resolves.toBe("TZ-20260911-0007");
    });

    it("客户：全局计数（忽略业务日期），CUS- + 至少 4 位", async () => {
        const { service, queryRaw, tx } = createService();
        queryRaw.mockResolvedValue([{ next_value: 42n }]);
        await expect(service.nextCode(tx, "customer", "不使用")).resolves.toBe("CUS-0042");
    });

    it("跨日期各自计数：sequence_key 含日期段", async () => {
        const { service, executeRaw, tx } = createService();
        await service.nextCode(tx, "order", "2026-09-11");
        // UPDATE 语句插值：next_value 在前、sequence_key 在后
        expect(executeRaw).toHaveBeenNthCalledWith(1, expect.anything(), 6n, "order:260911");
        await service.nextCode(tx, "customer", "2026-09-11");
        expect(executeRaw).toHaveBeenNthCalledWith(2, expect.anything(), 6n, "customer:global");
    });

    it("业务日期非法（非 yyyy-MM-dd）直接拒绝", async () => {
        const { service, tx } = createService();
        await expect(service.nextCode(tx, "order", "20260911")).rejects.toThrow("yyyy-MM-dd");
    });
});

describe("BusinessSequenceService.nextRaw（行锁取号）", () => {
    it("序列行已存在：跳过初始化，FOR UPDATE 读 + 递增写回", async () => {
        const { service, executeRaw, queryRaw, tx } = createService();
        const seq = await service.nextRaw(tx, "order:260911");
        expect(seq).toBe(5n);
        // 已存在时不执行 INSERT IGNORE，只有 UPDATE 一条写语句
        expect(executeRaw).toHaveBeenCalledTimes(1);
        expect(queryRaw).toHaveBeenCalledTimes(2);
        // UPDATE 语句插值顺序：先 next_value 再 sequence_key
        expect(executeRaw).toHaveBeenNthCalledWith(1, expect.anything(), 6n, "order:260911");
    });

    it("序列行不存在：无锁探测 miss 后 INSERT IGNORE 初始化再行锁取号", async () => {
        const { service, executeRaw, queryRaw, tx } = createService();
        queryRaw
            .mockResolvedValueOnce([]) // 探测 miss
            .mockResolvedValueOnce([{ next_value: 1n }]); // 初始化后 FOR UPDATE 读
        const seq = await service.nextRaw(tx, "order:260912");
        expect(seq).toBe(1n);
        expect(executeRaw).toHaveBeenNthCalledWith(1, expect.anything(), "order:260912");
        expect(executeRaw).toHaveBeenNthCalledWith(2, expect.anything(), 2n, "order:260912");
    });

    it("序列行初始化后不可见（防御）：抛错而非返回脏值", async () => {
        const { service, queryRaw, tx } = createService();
        queryRaw.mockResolvedValue([]);
        await expect(service.nextRaw(tx, "order:260911")).rejects.toThrow("取号失败");
    });
});

describe("BusinessSequenceService.nextBomCode（BOM 品类序列）", () => {
    it("格式化：品类前缀 + 至少 seqWidth 位序号，超宽自然增长", async () => {
        const { service, queryRaw, tx } = createService();
        queryRaw.mockResolvedValue([{ next_value: 5n }]);
        await expect(
            service.nextBomCode(tx, { categoryKey: "rotary-switch", codePrefix: "XK2", seqWidth: 3 }),
        ).resolves.toBe("XK2005");
        await expect(
            service.nextBomCode(tx, { categoryKey: "new-micro-switch", codePrefix: "KW", seqWidth: 3 }),
        ).resolves.toBe("KW005");
        await expect(
            service.nextBomCode(tx, { categoryKey: "old-micro-switch", codePrefix: "KWO", seqWidth: 3 }),
        ).resolves.toBe("KWO005");
        queryRaw.mockResolvedValue([{ next_value: 10000n }]);
        await expect(
            service.nextBomCode(tx, { categoryKey: "new-micro-switch", codePrefix: "KW", seqWidth: 3 }),
        ).resolves.toBe("KW10000");
    });

    it("品类序列首插从存量编码 MAX 续接：序号起点为前缀 之后（SUBSTRING 1 基）", async () => {
        const { service, executeRaw, tx } = createService();
        await service.nextBomCode(tx, { categoryKey: "rotary-switch", codePrefix: "XK2", seqWidth: 3 });
        // bootstrap INSERT 参数序：sequenceKey、digitsStart、categoryKey
        expect(executeRaw).toHaveBeenNthCalledWith(1, expect.anything(), "bom:rotary-switch", 4, "rotary-switch");
        await service.nextBomCode(tx, { categoryKey: "old-micro-switch", codePrefix: "KWO", seqWidth: 3 });
        expect(executeRaw).toHaveBeenNthCalledWith(3, expect.anything(), "bom:old-micro-switch", 4, "old-micro-switch");
    });

    it("bootstrap 必须 JOIN 品类过滤（KW 与 KWO 前缀相近，仅按前缀 LIKE 会跨品类互读）", async () => {
        const { service, executeRaw, tx } = createService();
        await service.nextBomCode(tx, { categoryKey: "new-micro-switch", codePrefix: "KW", seqWidth: 3 });
        const sql = String((executeRaw.mock.calls[0] as unknown[])[0]);
        expect(sql).toContain("JOIN bom_category");
        expect(sql).toContain("bc.category_key");
    });
});
