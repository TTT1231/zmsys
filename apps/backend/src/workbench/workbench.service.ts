import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { beijingDayKey } from "../common/beijing-day";
import { formatDateColumn } from "../common/datetime";
import { bomItemsSnapshotOf } from "../common/bom-display";
import { outboundQtyByOrderMap, stockByBomCodeMap } from "../domain/inventory";
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
 * movements 按业务日聚合有效入库与出库事件（v_outbound_effective_event，
 * 含作废冲销 CORRECTION；软删单不参与），与 v_bom_stock 的库存推导一致；
 * 库存调整计入库存但不当作出入库趋势。
 */
@Injectable()
export class WorkbenchService {
    constructor(private readonly prisma: PrismaService) {}

    async getOverview(): Promise<WorkbenchData> {
        const [bomRows, orderRows, stockByCode, outboundByOrderId, inboundRows, outboundRows] = await Promise.all([
            this.prisma.bomTable.findMany({
                orderBy: [{ category: { name: "asc" } }, { bomCode: "asc" }],
                include: { category: { select: { name: true } }, items: true },
            }),
            this.prisma.salesOrderTable.findMany({
                orderBy: { orderNo: "asc" },
                select: {
                    id: true,
                    orderNo: true,
                    orderDate: true,
                    deliverDate: true,
                    qty: true,
                    lifecycleStatus: true,
                    customer: { select: { customerCode: true, name: true } },
                    bom: { select: { bomCode: true } },
                },
            }),
            stockByBomCodeMap(this.prisma),
            outboundQtyByOrderMap(this.prisma),
            this.prisma.$queryRaw<MovementRow[]>`
                SELECT b.bom_code, i.business_date, SUM(i.qty) AS total
                FROM inbound_ledger AS i
                JOIN bom_table AS b ON b.id = i.bom_id
                WHERE i.status = 'ACTIVE'
                GROUP BY b.bom_code, i.business_date
            `,
            this.prisma.$queryRaw<MovementRow[]>`
                SELECT b.bom_code, e.business_date, SUM(e.qty_delta) AS total
                FROM v_outbound_effective_event AS e
                JOIN bom_table AS b ON b.id = e.bom_id
                GROUP BY b.bom_code, e.business_date
            `,
        ]);

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

        const orders: WorkbenchOrder[] = orderRows.map(row => ({
            no: row.orderNo,
            customerCode: row.customer.customerCode,
            customer: row.customer.name,
            bomCode: row.bom.bomCode,
            date: formatDateColumn(row.orderDate),
            due: formatDateColumn(row.deliverDate),
            qty: row.qty,
            shipped: outboundByOrderId.get(row.id) ?? 0,
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
