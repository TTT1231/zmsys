import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { formatDateColumn, toDateColumn } from "../common/datetime";
import { beijingDayKey } from "../common/beijing-day";
import { Prisma } from "../generated/prisma/client";
import type { RelationFacts, RelationNode, RelationsData, RelationType } from "./relations.types";
import type { RelationsQueryDto } from "./relations-query.dto";
import { RELATION_TYPE_KEYS } from "./relations-query.dto";

const personSelect = { id: true, name: true, roleCode: true } as const;
// 整图不截断：上限只阻止过大的查询，成功返回的统计和关联仍完整。
const RELATION_LIMITS = { orders: 1_000, boms: 1_000, ledgers: 1_000, nodes: 1_500 } as const;
const assertWithinLimit = (count: number, limit: number, label: string) => {
    if (count > limit)
        throw new BadRequestException(
            `业务关系数据较多（${label}超过 ${limit.toLocaleString("zh-CN")} ${label === "关联节点" ? "个" : "条"}），请缩短业务日期范围，或按订单、BOM、客户编号查询`,
        );
};
const roleNames: Record<string, string> = {
    super: "超级管理员",
    admin: "管理员",
    sales: "销售",
    warehouse: "仓管",
    staff: "普通员工",
};

@Injectable()
export class RelationsService {
    constructor(private readonly prisma: PrismaService) {}

    async getRelations(query: Partial<RelationsQueryDto>): Promise<RelationsData> {
        if (query.start && query.end && query.start > query.end)
            throw new BadRequestException("开始日期不能晚于结束日期");
        // 同一事务内顺序读取（READ COMMITTED，各语句独立快照；Prisma itx 的
        // isolationLevel 选项被 adapter 静默忽略，勿再加）
        return this.prisma.$transaction(tx => this.aggregate(tx, query), {
            timeout: 15_000,
        });
    }

    private async aggregate(
        db: Prisma.TransactionClient,
        {
            status = "open",
            types = RELATION_TYPE_KEYS,
            start,
            end,
            orderNo,
            bomCode,
            customerCode,
        }: Partial<RelationsQueryDto>,
    ): Promise<RelationsData> {
        const dates = { ...(start ? { gte: toDateColumn(start) } : {}), ...(end ? { lte: toDateColumn(end) } : {}) };
        const bounded = !!start || !!end;
        // 显式软删条件也约束嵌套关联；作废但未删除的单据保留追溯关系。
        const orders = await db.salesOrderTable.findMany({
            where: {
                deletedAt: null,
                ...(orderNo ? { orderNo } : {}),
                ...(bomCode ? { bom: { bomCode } } : {}),
                ...(customerCode ? { customer: { customerCode } } : {}),
                ...(bounded
                    ? { OR: [{ orderDate: dates }, { shipments: { some: { deletedAt: null, businessDate: dates } } }] }
                    : {}),
            },
            orderBy: { orderNo: "asc" },
            take: RELATION_LIMITS.orders + 1,
            select: {
                id: true,
                orderNo: true,
                qty: true,
                orderDate: true,
                deliverDate: true,
                lifecycleStatus: true,
                bomId: true,
                customerId: true,
                creator: { select: personSelect },
                archiver: { select: personSelect },
                customer: { select: { id: true, customerCode: true, name: true, owner: { select: personSelect } } },
                bom: { select: { id: true, bomCode: true, unit: true, creator: { select: personSelect } } },
            },
        });
        // 候选订单参与所有状态计数，不可只截取当前状态后继续聚合。
        assertWithinLimit(orders.length, RELATION_LIMITS.orders, "候选订单");
        const shippedRows = orders.length
            ? await db.$queryRaw<{ order_id: bigint; outbound_qty: bigint | number }[]>`
            SELECT order_id, outbound_qty FROM v_order_outbound_qty
            WHERE order_id IN (${Prisma.join(orders.map(o => o.id))})
        `
            : [];
        const shipped = new Map(shippedRows.map(row => [row.order_id, Number(row.outbound_qty)]));
        const open = orders.filter(o => o.lifecycleStatus === "ACTIVE" && o.qty > (shipped.get(o.id) ?? 0));
        const completed = orders.filter(o => (shipped.get(o.id) ?? 0) >= o.qty);
        const archived = orders.filter(o => o.lifecycleStatus === "ARCHIVED");
        const chosen =
            status === "open" ? open : status === "completed" ? completed : status === "archived" ? archived : orders;
        const data: RelationsData = {
            schemaVersion: 1,
            asOf: beijingDayKey(),
            generatedAt: new Date().toISOString(),
            filters: {
                status,
                start: start ?? null,
                end: end ?? null,
                types: [...new Set(types)],
                orderNo: orderNo ?? null,
                bomCode: bomCode ?? null,
                customerCode: customerCode ?? null,
            },
            nodes: [],
            edges: [],
            counts: { open: open.length, completed: completed.length, archived: archived.length, all: orders.length },
            typeCounts: { bom: 0, customer: 0, order: 0, inbound: 0, outbound: 0, person: 0 },
            summary: { orderCount: chosen.length, overdueOrderIds: [], quantitiesByUnit: [] },
        };
        const boms = new Map(chosen.map(o => [o.bomId, o.bom]));
        // 全部范围兼容仅有入库、尚未下单的 BOM；订单/客户精确查询不夹带无关记录。
        if (status === "all" && !orderNo && !customerCode) {
            const inboundBoms = await db.bomTable.findMany({
                where: {
                    ...(bomCode ? { bomCode } : {}),
                    inboundEntries: {
                        some: {
                            deletedAt: null,
                            ...(bounded ? { businessDate: dates } : {}),
                        },
                    },
                },
                orderBy: { bomCode: "asc" },
                take: RELATION_LIMITS.boms + 1,
                select: { id: true, bomCode: true, unit: true, creator: { select: personSelect } },
            });
            assertWithinLimit(inboundBoms.length, RELATION_LIMITS.boms, "BOM");
            inboundBoms.forEach(b => boms.set(b.id, b));
        }
        assertWithinLimit(boms.size, RELATION_LIMITS.boms, "BOM");
        if (!boms.size) return data;
        const stockRows = await db.$queryRaw<{ bom_code: string; stock_qty: bigint | number }[]>`
            SELECT b.bom_code, v.stock_qty FROM v_bom_stock AS v
            JOIN bom_table AS b ON b.id = v.bom_id
            WHERE b.id IN (${Prisma.join([...boms.keys()])})
        `;
        const stock = new Map(stockRows.map(row => [row.bom_code, Number(row.stock_qty)]));
        const customers = new Map(chosen.map(o => [o.customerId, o.customer]));
        const orderById = new Map(chosen.map(o => [o.id, o]));
        const [inbounds, outbounds] = await Promise.all([
            db.inboundLedger.findMany({
                where: {
                    deletedAt: null,
                    bomId: { in: [...boms.keys()] },
                    ...(bounded ? { businessDate: dates } : {}),
                },
                orderBy: { entryNo: "asc" },
                take: RELATION_LIMITS.ledgers + 1,
                select: {
                    id: true,
                    entryNo: true,
                    bomId: true,
                    qty: true,
                    status: true,
                    businessDate: true,
                    operator: { select: personSelect },
                },
            }),
            db.outboundShipment.findMany({
                where: {
                    deletedAt: null,
                    orderId: { in: [...orderById.keys()] },
                    ...(bounded ? { businessDate: dates } : {}),
                },
                orderBy: { shipmentNo: "asc" },
                take: RELATION_LIMITS.ledgers + 1,
                select: {
                    id: true,
                    shipmentNo: true,
                    orderId: true,
                    originalQty: true,
                    state: true,
                    businessDate: true,
                    registrar: { select: personSelect },
                },
            }),
        ]);
        assertWithinLimit(inbounds.length, RELATION_LIMITS.ledgers, "入库单");
        assertWithinLimit(outbounds.length, RELATION_LIMITS.ledgers, "出库单");
        const nodes = new Map<string, RelationNode>();
        const key = (type: RelationType, id: bigint) => `${type}:${id}`;
        const node = (
            type: RelationType,
            id: bigint,
            name: string,
            properties: Record<string, string>,
            facts: RelationFacts,
            voided = false,
        ) => {
            const k = key(type, id);
            if (!nodes.has(k)) assertWithinLimit(nodes.size + 1, RELATION_LIMITS.nodes, "关联节点");
            nodes.set(k, { id: k, type, name, properties, facts, ...(voided ? { voided: true } : {}) });
            return k;
        };
        const edge = (source: string, target: string, relation: string, kind: "business" | "person" = "business") => {
            data.edges.push({ source, target, relation, kind });
        };
        const person = (p: { id: bigint; name: string; roleCode: string } | null, target: string, relation: string) => {
            if (p)
                edge(
                    node(
                        "person",
                        p.id,
                        p.name,
                        { 角色: roleNames[p.roleCode] ?? p.roleCode },
                        { type: "person", role: p.roleCode },
                    ),
                    target,
                    relation,
                    "person",
                );
        };
        const quantity = (qty: number, unit: string) => `${qty.toLocaleString("zh-CN")} ${unit}`;
        for (const b of boms.values()) {
            const stockQty = stock.get(b.bomCode) ?? 0;
            const id = node(
                "bom",
                b.id,
                b.bomCode,
                { BOM编号: b.bomCode, 单位: b.unit, 当前库存: quantity(stockQty, b.unit), 建档人: b.creator.name },
                {
                    type: "bom",
                    code: b.bomCode,
                    unit: b.unit,
                    stock: stockQty,
                    createdById: key("person", b.creator.id),
                },
            );
            person(b.creator, id, "建档");
        }
        for (const c of customers.values()) {
            const id = node(
                "customer",
                c.id,
                c.name,
                { 客户编号: c.customerCode, 负责人: c.owner.name },
                { type: "customer", code: c.customerCode, ownerId: key("person", c.owner.id) },
            );
            person(c.owner, id, "负责客户");
        }
        const totals = new Map<string, { unit: string; ordered: number; shipped: number; pending: number }>();
        for (const o of chosen) {
            const outbound = shipped.get(o.id) ?? 0;
            const unshippedQty = Math.max(0, o.qty - outbound);
            const archived = o.lifecycleStatus === "ARCHIVED";
            const pendingQty = archived ? 0 : unshippedQty;
            const date = formatDateColumn(o.orderDate),
                due = formatDateColumn(o.deliverDate);
            const id = node(
                "order",
                o.id,
                o.orderNo,
                {
                    状态:
                        o.lifecycleStatus === "ARCHIVED"
                            ? "已归档"
                            : outbound >= o.qty
                              ? "已完成"
                              : outbound > 0
                                ? "部分发货"
                                : "待发货",
                    客户: o.customer.name,
                    BOM: o.bom.bomCode,
                    订单数量: quantity(o.qty, o.bom.unit),
                    累计已发: quantity(outbound, o.bom.unit),
                    未完成数量: quantity(Math.max(0, o.qty - outbound), o.bom.unit),
                    下单日期: date,
                    交期: due,
                    创建人: o.creator.name,
                },
                {
                    type: "order",
                    no: o.orderNo,
                    date,
                    due,
                    qty: o.qty,
                    shipped: outbound,
                    unshippedQty,
                    pendingQty,
                    archived,
                    unit: o.bom.unit,
                    bomId: key("bom", o.bomId),
                    customerId: key("customer", o.customerId),
                    createdById: key("person", o.creator.id),
                    archivedById: archived && o.archiver ? key("person", o.archiver.id) : null,
                },
            );
            if (pendingQty > 0 && due < data.asOf) data.summary.overdueOrderIds.push(id);
            const total = totals.get(o.bom.unit) ?? { unit: o.bom.unit, ordered: 0, shipped: 0, pending: 0 };
            total.ordered += o.qty;
            total.shipped += outbound;
            total.pending += pendingQty;
            totals.set(o.bom.unit, total);
            edge(key("customer", o.customerId), id, "下单");
            edge(id, key("bom", o.bomId), "订购");
            person(o.creator, id, "创建订单");
            if (o.lifecycleStatus === "ARCHIVED") person(o.archiver, id, "归档");
        }
        for (const i of inbounds) {
            const b = boms.get(i.bomId)!;
            const id = node(
                "inbound",
                i.id,
                i.entryNo,
                {
                    BOM: b.bomCode,
                    入库数量: quantity(i.qty, b.unit),
                    日期: formatDateColumn(i.businessDate),
                    状态: i.status === "VOIDED" ? "已作废" : "有效",
                    检验入库人: i.operator.name,
                },
                {
                    type: "inbound",
                    no: i.entryNo,
                    date: formatDateColumn(i.businessDate),
                    qty: i.qty,
                    voided: i.status === "VOIDED",
                    unit: b.unit,
                    bomId: key("bom", i.bomId),
                    operatorId: key("person", i.operator.id),
                },
                i.status === "VOIDED",
            );
            edge(id, key("bom", i.bomId), "入库");
            person(i.operator, id, "检验入库");
        }
        for (const s of outbounds) {
            const o = orderById.get(s.orderId)!;
            const id = node(
                "outbound",
                s.id,
                s.shipmentNo,
                {
                    销售订单: o.orderNo,
                    BOM: o.bom.bomCode,
                    登记数量: quantity(s.originalQty, o.bom.unit),
                    日期: formatDateColumn(s.businessDate),
                    状态: s.state === "VOIDED" ? "已作废" : "已登记",
                    登记人: s.registrar.name,
                },
                {
                    type: "outbound",
                    no: s.shipmentNo,
                    date: formatDateColumn(s.businessDate),
                    qty: s.originalQty,
                    voided: s.state === "VOIDED",
                    unit: o.bom.unit,
                    bomId: key("bom", o.bomId),
                    orderId: key("order", s.orderId),
                    operatorId: key("person", s.registrar.id),
                },
                s.state === "VOIDED",
            );
            edge(key("order", s.orderId), id, "发货");
            person(s.registrar, id, "登记发货");
        }
        const enabled = new Set(types);
        for (const n of nodes.values()) data.typeCounts[n.type]++;
        data.nodes = [...nodes.values()].filter(n => enabled.has(n.type));
        const ids = new Set(data.nodes.map(n => n.id));
        data.edges = data.edges.filter(e => ids.has(e.source) && ids.has(e.target));
        data.summary.quantitiesByUnit = [...totals.values()];
        return data;
    }
}
