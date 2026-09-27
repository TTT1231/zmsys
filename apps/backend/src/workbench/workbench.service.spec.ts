// WorkbenchService 真实聚合映射：产品快照派生与缺行库存、订单净额缺行与归档标记、
// 出入库按业务日合并（同日出入一行、跨日冲销净额）、单位推导（唯一/混合）
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchService } from "./workbench.service";
import { PrismaService } from "../prisma/prisma.service";
import type { WorkbenchData } from "./types";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

interface BomFixture {
    id: bigint;
    bomCode: string;
    unit: string;
    category: { name: string };
    items: Array<{
        materialId: bigint;
        groupKey: string;
        groupName: string;
        name: string;
        position: number;
        quantity?: number;
    }>;
}

interface OrderFixture {
    id: bigint;
    orderNo: string;
    qty: number;
    lifecycleStatus: "ACTIVE" | "ARCHIVED";
    orderDate: Date;
    deliverDate: Date;
    customer: { customerCode: string; name: string };
    bom: { bomCode: string };
}

const bomItems = [
    { materialId: 101n, groupKey: "model", groupName: "型号", name: "1-1", position: 1 },
    { materialId: 102n, groupKey: "base", groupName: "底座", name: "三脚底座", position: 2, quantity: 2 },
];

const boms: BomFixture[] = [
    { id: 11n, bomCode: "ZMKW0001", unit: "个", category: { name: "新微动" }, items: bomItems },
    { id: 12n, bomCode: "ZMKW0002", unit: "个", category: { name: "新微动" }, items: bomItems },
];

const orders: OrderFixture[] = [
    {
        id: 21n,
        orderNo: "ZM2609120001",
        qty: 1000,
        lifecycleStatus: "ACTIVE",
        orderDate: day("2026-09-01"),
        deliverDate: day("2026-09-15"),
        customer: { customerCode: "CUS-0001", name: "浙江正泰电器有限公司" },
        bom: { bomCode: "ZMKW0001" },
    },
    {
        id: 22n,
        orderNo: "ZM2609120002",
        qty: 500,
        lifecycleStatus: "ACTIVE",
        orderDate: day("2026-09-02"),
        deliverDate: day("2026-09-16"),
        customer: { customerCode: "CUS-0002", name: "宁波方太厨具有限公司" },
        bom: { bomCode: "ZMKW0001" },
    },
    {
        id: 23n,
        orderNo: "ZM2609120003",
        qty: 200,
        lifecycleStatus: "ARCHIVED",
        orderDate: day("2026-09-03"),
        deliverDate: day("2026-09-17"),
        customer: { customerCode: "CUS-0001", name: "浙江正泰电器有限公司" },
        bom: { bomCode: "ZMKW0002" },
    },
];

// v_bom_stock / v_order_outbound_qty / inbound / outbound 四类视图查询的返回
const stockRows = [{ bom_code: "ZMKW0001", stock_qty: 260n }];
const outboundQtyRows = [
    { order_id: 21n, outbound_qty: 300n },
    { order_id: 22n, outbound_qty: 120n },
];
const inboundRows = [{ bom_code: "ZMKW0001", business_date: day("2026-09-10"), total: 500n }];
const outboundRows = [
    { bom_code: "ZMKW0001", business_date: day("2026-09-10"), total: 300n },
    { bom_code: "ZMKW0001", business_date: day("2026-09-12"), total: -100n },
];

const mkService = (overrides?: {
    boms?: BomFixture[];
    stockRows?: typeof stockRows;
    outboundQtyRows?: typeof outboundQtyRows;
    inboundRows?: typeof inboundRows;
    outboundRows?: typeof outboundRows;
}): { service: WorkbenchService; queryRaw: ReturnType<typeof vi.fn> } => {
    const queryRaw = vi.fn(async (strings: readonly string[]) => {
        const sql = strings.join("?");
        if (sql.includes("v_bom_stock")) return overrides?.stockRows ?? stockRows;
        if (sql.includes("v_order_outbound_qty")) return overrides?.outboundQtyRows ?? outboundQtyRows;
        if (sql.includes("inbound_ledger")) return overrides?.inboundRows ?? inboundRows;
        if (sql.includes("outbound_ledger")) return overrides?.outboundRows ?? outboundRows;
        throw new Error(`未预期的查询：${sql}`);
    });
    const prisma = {
        bomTable: { findMany: vi.fn(async () => overrides?.boms ?? boms) },
        salesOrderTable: { findMany: vi.fn(async () => orders) },
        $queryRaw: queryRaw,
    } as unknown as PrismaService;
    return { service: new WorkbenchService(prisma), queryRaw };
};

describe("WorkbenchService.getOverview", () => {
    let data: WorkbenchData;

    beforeEach(async () => {
        data = await mkService().service.getOverview();
    });

    it("产品由冻结明细派生型号与规格，库存缺行按 0 理解", () => {
        expect(data.products).toEqual([
            {
                code: "ZMKW0001",
                category: "新微动",
                model: "1-1",
                spec: "型号：1-1 · 底座：三脚底座 ×2",
                unit: "个",
                stock: 260,
            },
            {
                code: "ZMKW0002",
                category: "新微动",
                model: "1-1",
                spec: "型号：1-1 · 底座：三脚底座 ×2",
                unit: "个",
                stock: 0,
            },
        ]);
    });

    it("订单 shipped 取视图净额（缺行 0），归档订单带 archived 标记，日期为 yyyy-MM-dd", () => {
        expect(data.orders).toEqual([
            {
                no: "ZM2609120001",
                customerCode: "CUS-0001",
                customer: "浙江正泰电器有限公司",
                bomCode: "ZMKW0001",
                date: "2026-09-01",
                due: "2026-09-15",
                qty: 1000,
                shipped: 300,
            },
            {
                no: "ZM2609120002",
                customerCode: "CUS-0002",
                customer: "宁波方太厨具有限公司",
                bomCode: "ZMKW0001",
                date: "2026-09-02",
                due: "2026-09-16",
                qty: 500,
                shipped: 120,
            },
            {
                no: "ZM2609120003",
                customerCode: "CUS-0001",
                customer: "浙江正泰电器有限公司",
                bomCode: "ZMKW0002",
                date: "2026-09-03",
                due: "2026-09-17",
                qty: 200,
                shipped: 0,
                archived: true,
            },
        ]);
    });

    it("出入库按业务日合并：同日出入一行，跨日冲销净额单独成行，按日期排序", () => {
        expect(data.movements).toEqual([
            { date: "2026-09-10", bomCode: "ZMKW0001", inbound: 500, outbound: 300 },
            { date: "2026-09-12", bomCode: "ZMKW0001", inbound: 0, outbound: -100 },
        ]);
    });

    it("单位唯一时取该值，截至日为北京日 yyyy-MM-dd", () => {
        expect(data.unit).toBe("个");
        expect(data.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("BOM 单位混合时顶层单位显示“多单位”", async () => {
        const mixed = await mkService({
            boms: [
                { id: 11n, bomCode: "ZMKW0001", unit: "个", category: { name: "新微动" }, items: bomItems },
                { id: 12n, bomCode: "ZMXK2001", unit: "套", category: { name: "旋转XK2" }, items: bomItems },
            ],
            stockRows: [],
            outboundQtyRows: [],
            inboundRows: [],
            outboundRows: [],
        }).service.getOverview();
        expect(mixed.unit).toBe("多单位");
        expect(mixed.movements).toEqual([]);
    });

    it("空库时返回空模型且单位回退“个”", async () => {
        const empty = await mkService({
            boms: [],
            stockRows: [],
            outboundQtyRows: [],
            inboundRows: [],
            outboundRows: [],
        }).service.getOverview();
        expect(empty).toMatchObject({ unit: "个", products: [], movements: [] });
        expect(empty.orders.map(order => [order.no, order.shipped])).toEqual([
            ["ZM2609120001", 0],
            ["ZM2609120002", 0],
            ["ZM2609120003", 0],
        ]);
    });
});
