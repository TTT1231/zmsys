import { describe, expect, it } from "vitest";
import type { RelationEdge, RelationFacts, RelationNode, RelationType } from "@/data/relations";
import {
    buildRelationLayout,
    relationLabelIds,
    relationNodeVisual,
    relationSymbolScale,
} from "@/pages/analytics/relationLayout";

const node = (type: RelationType, id: string, bomId = "bom:1", orderId = "order:1"): RelationNode => {
    let facts: RelationFacts;
    switch (type) {
        case "bom":
            facts = { type, code: id, unit: "个", stock: 0, createdById: "person:1" };
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
                customerId: "customer:1",
                createdById: "person:1",
                archivedById: null,
            };
            break;
    }
    return { id, type, facts, name: id, properties: {} };
};
const edge = (source: string, target: string, kind: RelationEdge["kind"] = "business"): RelationEdge => ({
    source,
    target,
    kind,
    relation: "关联",
});

const history = (bomCount: number, ordersPerBom: number, receiptsPerBom: number, shipmentsPerOrder: number) => {
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
    return { nodes, edges };
};

describe("稳定业务关系布局", () => {
    it("输入顺序、共享客户和人员不会让 BOM 家族互相合并或随机换位", () => {
        const { nodes, edges } = history(4, 3, 4, 2);
        const first = buildRelationLayout(nodes, edges);
        const reordered = buildRelationLayout([...nodes].reverse(), [...edges].reverse());
        expect(reordered).toEqual(first);
        expect(buildRelationLayout(nodes, edges)).toEqual(first);
        for (let b = 0; b < 4; b++) {
            const order = first.get(`order:${b}:0`)!,
                shipment = first.get(`outbound:${b}:0:0`)!;
            expect(Math.hypot(order[0] - shipment[0], order[1] - shipment[1])).toBeLessThan(120);
        }
    });

    it("千节点历史中每个实体只有一个有限坐标，节点间保留间距", () => {
        const { nodes, edges } = history(30, 4, 8, 5);
        expect(nodes.length).toBe(992);
        const layout = buildRelationLayout(nodes, edges);
        expect(layout.size).toBe(nodes.length);
        const points = [...layout.values()];
        expect(points.every(point => point.every(Number.isFinite))).toBe(true);
        let minDistance = Infinity;
        for (let i = 0; i < points.length; i++) {
            for (let j = i + 1; j < points.length; j++)
                // Check spatial separation, rather than a brittle snapshot of implementation coordinates.
                minDistance = Math.min(
                    minDistance,
                    Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]),
                );
        }
        expect(minDistance).toBeGreaterThanOrEqual(60);
    });

    it("隐藏 BOM /订单类型后仍保留其真实家族；不存在的边不会引入节点", () => {
        const { nodes, edges } = history(2, 2, 2, 3);
        const filtered = nodes.filter(item => item.type !== "bom" && item.type !== "order");
        const ids = new Set(filtered.map(item => item.id));
        const filteredEdges = edges.filter(item => ids.has(item.source) && ids.has(item.target));
        const layout = buildRelationLayout(filtered, [...filteredEdges, edge("missing", "person:1")]);
        expect(layout.size).toBe(filtered.length);
        expect([...layout.values()].every(point => point.every(Number.isFinite))).toBe(true);
        expect(buildRelationLayout([], [])).toEqual(new Map());
    });

    it("密集图限制概览标签，选中共享人员也不会展开全部历史标签", () => {
        const { nodes, edges } = history(30, 4, 8, 5);
        const overview = relationLabelIds(nodes, edges, null);
        const selected = relationLabelIds(nodes, edges, "person:1");
        expect(overview.size).toBeLessThanOrEqual(24);
        expect(selected.has("person:1")).toBe(true);
        expect(selected.size).toBeLessThanOrEqual(61);
        const orderSelection = relationLabelIds(nodes, edges, "order:0:0");
        expect(orderSelection.has("order:0:0")).toBe(true);
        expect(orderSelection.has("outbound:0:0:0")).toBe(true);
    });

    it("画布缩小时节点物理圆跟随 contain 比例缩小，屏幕标签也按可用面积降级", () => {
        const { nodes, edges } = history(10, 3, 6, 2);
        const layout = buildRelationLayout(nodes, edges, 3);
        const desktop = relationSymbolScale(layout, 1300, 480, nodes.length);
        const phone = relationSymbolScale(layout, 375, 480, nodes.length);
        expect(phone).toBeLessThan(desktop);
        const values = [...layout.values()],
            x = values.map(point => point[0]),
            y = values.map(point => point[1]);
        const scale = Math.min(
            (375 - 160) / (Math.max(...x) - Math.min(...x)),
            (480 - 135) / (Math.max(...y) - Math.min(...y)),
        );
        // Even two maximum-size BOM circles fit well inside adjacent 72-unit cells at overview zoom.
        expect(51 * phone).toBeLessThan(72 * scale);
        const desktopLabels = relationLabelIds(nodes, edges, null, { width: 1300, height: 480 });
        const phoneLabels = relationLabelIds(nodes, edges, null, { width: 375, height: 480 });
        expect(phoneLabels.size).toBeLessThan(desktopLabels.size);
        expect(phoneLabels.size).toBeLessThanOrEqual(10);
    });

    it("小流水节点保留可辨色块和细描边，安全下限不会超过画布间距上限", () => {
        const ledger = relationNodeVisual(14, 0.1);
        expect(ledger.symbolSize).toBeGreaterThan(14 * 0.1);
        expect(ledger.symbolSize).toBeLessThanOrEqual(51 * 0.1);
        expect(ledger.borderWidth).toBeLessThanOrEqual(0.4);
        expect(ledger.borderWidth * 2).toBeLessThan(ledger.symbolSize / 3);
        const normal = relationNodeVisual(14, 0.3);
        expect(normal.symbolSize).toBeGreaterThanOrEqual(4);
        const tiny = relationNodeVisual(14, 0.01);
        expect(tiny.symbolSize).toBeLessThanOrEqual(51 * 0.01);
        expect(tiny.borderWidth * 2).toBeLessThan(tiny.symbolSize / 3);
        expect(relationNodeVisual(51, 1)).toEqual({ symbolSize: 51, borderWidth: 1.5 });
        expect(relationNodeVisual(51, 1, true)).toEqual({ symbolSize: 51, borderWidth: 2 });
    });
});
