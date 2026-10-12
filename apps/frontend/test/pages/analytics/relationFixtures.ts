import type { RelationEdge, RelationFacts, RelationNode, RelationType, RelationsData } from "@/data/relations";

export const node = (type: RelationType, id: string, bomId = "bom:0", orderId = "order:0:0"): RelationNode => {
    let facts: RelationFacts;
    switch (type) {
        case "bom":
            facts = { type, code: id, unit: "个", stock: 20, createdById: "person:1" };
            break;
        case "customer":
            facts = { type, code: id, ownerId: "person:1" };
            break;
        case "person":
            facts = { type, role: "sales" };
            break;
        case "inbound":
            facts = {
                type,
                no: id,
                date: "2026-10-01",
                qty: 1,
                voided: false,
                unit: "个",
                bomId,
                operatorId: "person:1",
            };
            break;
        case "outbound":
            facts = {
                type,
                no: id,
                date: "2026-10-01",
                qty: 1,
                voided: false,
                unit: "个",
                bomId,
                orderId,
                operatorId: "person:1",
            };
            break;
        case "order":
            facts = {
                type,
                no: id,
                date: "2026-10-01",
                due: "2026-10-09",
                qty: 1,
                shipped: 0,
                unshippedQty: 1,
                pendingQty: 1,
                archived: false,
                unit: "个",
                bomId,
                customerId: "customer:shared",
                createdById: "person:1",
                archivedById: null,
            };
            break;
    }
    return { id, type, facts, name: id, properties: { 编号: id } };
};
export const edge = (source: string, target: string, kind: RelationEdge["kind"] = "business"): RelationEdge => ({
    source,
    target,
    kind,
    relation: "关联",
});

export const history = (
    bomCount: number,
    ordersPerBom: number,
    receiptsPerBom: number,
    shipmentsPerOrder: number,
): RelationsData => {
    const nodes: RelationNode[] = [node("customer", "customer:shared"), node("person", "person:1")];
    const edges: RelationEdge[] = [];
    for (let b = 0; b < bomCount; b++) {
        const bomId = `bom:${b}`;
        nodes.push(node("bom", bomId));
        edges.push(edge("person:1", bomId, "person"));
        for (let i = 0; i < receiptsPerBom; i++) {
            const id = `inbound:${b}:${i}`;
            nodes.push(node("inbound", id, bomId));
            edges.push(edge(id, bomId), edge("person:1", id, "person"));
        }
        for (let o = 0; o < ordersPerBom; o++) {
            const orderId = `order:${b}:${o}`;
            nodes.push(node("order", orderId, bomId));
            edges.push(edge(orderId, bomId), edge("customer:shared", orderId), edge("person:1", orderId, "person"));
            for (let s = 0; s < shipmentsPerOrder; s++) {
                const id = `outbound:${b}:${o}:${s}`;
                nodes.push(node("outbound", id, bomId, orderId));
                edges.push(edge(orderId, id), edge("person:1", id, "person"));
            }
        }
    }
    return {
        schemaVersion: 1,
        asOf: "2026-10-12",
        generatedAt: "",
        filters: { status: "all", start: null, end: null, types: [], orderNo: null, bomCode: null, customerCode: null },
        nodes,
        edges,
        counts: { open: 0, completed: 0, archived: 0, all: bomCount * ordersPerBom },
        typeCounts: {
            bom: bomCount,
            customer: 1,
            person: 1,
            order: bomCount * ordersPerBom,
            inbound: bomCount * receiptsPerBom,
            outbound: bomCount * ordersPerBom * shipmentsPerOrder,
        },
        summary: { orderCount: 0, overdueOrderIds: [], quantitiesByUnit: [] },
    };
};
