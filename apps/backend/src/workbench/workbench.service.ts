import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { beijingDayKey } from "../common/beijing-day";
import { formatDateColumn } from "../common/datetime";
import { bomItemsSnapshotOf } from "../common/bom-display";
import type { WorkbenchData, WorkbenchMovement, WorkbenchOrder, WorkbenchProduct } from "./types";

/** 按 (bom_code, 业务日) 聚合的流水行 */
interface MovementRow {
    bom_code: string;
    business_date: Date;
    total: bigint | number;
}

/** 顶层单位标签：全部 BOM 单位一致时取该值，混合时仅作展示（BOM 默认“个”） */
const unitLabelOf = (products: WorkbenchProduct[]): string => {
    const units = new Set(products.map(product => product.unit));
    if (units.size === 0) return "个";
    return units.size === 1 ? [...units][0] : "多单位";
};

/**
 * 工作台经营总览聚合：products 含 v_bom_stock 实时库存，orders 的 shipped 经
 * v_order_outbound_qty 统一净额口径（无流水订单不在视图，缺行按 0 理解），
 * movements 按业务日聚合有效入库与出库净额（含作废冲销 CORRECTION），
 * 与 v_bom_stock 的库存推导一致；库存调整计入库存但不当作出入库趋势。
 */
@Injectable()
export class WorkbenchService {
    constructor(private readonly prisma: PrismaService) {}

    async getOverview(): Promise<WorkbenchData> {
        const [bomRows, orderRows, stockRows, outboundQtyRows, inboundRows, outboundRows] = await Promise.all([
            this.prisma.bomTable.findMany({
                orderBy: [{ category: { name: "asc" } }, { bomCode: "asc" }],
                include: { category: { select: { name: true } }, items: true },
            }),
            this.prisma.salesOrderTable.findMany({
                orderBy: { orderNo: "asc" },
                include: {
                    customer: { select: { customerCode: true, name: true } },
                    bom: { select: { bomCode: true } },
                },
            }),
            this.prisma.$queryRaw<Array<{ bom_code: string; stock_qty: bigint | number }>>`
                SELECT b.bom_code, v.stock_qty
                FROM v_bom_stock AS v
                JOIN bom_table AS b ON b.id = v.bom_id
            `,
            this.prisma.$queryRaw<Array<{ order_id: bigint; outbound_qty: bigint | number }>>`
                SELECT order_id, outbound_qty FROM v_order_outbound_qty
            `,
            this.prisma.$queryRaw<MovementRow[]>`
                SELECT b.bom_code, i.business_date, SUM(i.qty) AS total
                FROM inbound_ledger AS i
                JOIN bom_table AS b ON b.id = i.bom_id
                WHERE i.status = 'ACTIVE'
                GROUP BY b.bom_code, i.business_date
            `,
            this.prisma.$queryRaw<MovementRow[]>`
                SELECT b.bom_code, e.business_date, SUM(e.qty_delta) AS total
                FROM outbound_ledger AS e
                JOIN outbound_shipment AS s ON s.id = e.shipment_id
                JOIN sales_order_table AS o ON o.id = s.order_id
                JOIN bom_table AS b ON b.id = o.bom_id
                GROUP BY b.bom_code, e.business_date
            `,
        ]);

        const stockByCode = new Map(stockRows.map(row => [row.bom_code, Number(row.stock_qty)]));
        const products: WorkbenchProduct[] = bomRows.map(row => {
            const snapshot = bomItemsSnapshotOf(row.items);
            return {
                code: row.bomCode,
                category: row.category.name,
                model: snapshot.modelCode,
                spec: snapshot.spec,
                unit: row.unit,
                stock: stockByCode.get(row.bomCode) ?? 0,
            };
        });

        const outboundByOrderId = new Map(outboundQtyRows.map(row => [row.order_id, Number(row.outbound_qty)]));
        const orders: WorkbenchOrder[] = orderRows.map(row => ({
            no: row.orderNo,
            customerCode: row.customer.customerCode,
            customer: row.customer.name,
            bomCode: row.bom.bomCode,
            date: formatDateColumn(row.orderDate),
            due: formatDateColumn(row.deliverDate),
            qty: row.qty,
            shipped: outboundByOrderId.get(row.id) ?? 0,
            ...(row.lifecycleStatus === "CANCELLED" ? { cancelled: true } : {}),
            ...(row.lifecycleStatus === "ARCHIVED" ? { archived: true } : {}),
        }));

        const movementMap = new Map<string, WorkbenchMovement>();
        const movementOf = (row: MovementRow): WorkbenchMovement => {
            const key = `${row.bom_code}|${formatDateColumn(row.business_date)}`;
            const movement = movementMap.get(key) ?? {
                date: formatDateColumn(row.business_date),
                bomCode: row.bom_code,
                inbound: 0,
                outbound: 0,
            };
            movementMap.set(key, movement);
            return movement;
        };
        for (const row of inboundRows) movementOf(row).inbound += Number(row.total);
        for (const row of outboundRows) movementOf(row).outbound += Number(row.total);
        const movements = [...movementMap.values()].sort(
            (a, b) => a.date.localeCompare(b.date) || a.bomCode.localeCompare(b.bomCode),
        );

        return {
            asOf: beijingDayKey(),
            unit: unitLabelOf(products),
            products,
            orders,
            movements,
        };
    }
}
