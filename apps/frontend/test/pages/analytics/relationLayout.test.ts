import { describe, expect, it } from "vitest";
import {
    buildRelationFamilies,
    buildGlobalRelationGraph,
    buildRelationLayout,
    relationDragIds,
    relationEdgePath,
    RELATION_CARD,
} from "@/pages/analytics/relationLayout";
import { fitRelationView } from "@/pages/analytics/useRelationChart";
import { edge, history, node } from "./relationFixtures";

describe("型号业务树布局", () => {
    it("缩为圆点后连线连接圆周，人员线也切换到圆点的上下端口", () => {
        const business = relationEdgePath([0, 0], [232, 0], "business", true);
        expect(business.startsWith("M 107 34")).toBe(true);
        expect(business.endsWith("H 305")).toBe(true);
        const person = relationEdgePath([0, 176], [232, 0], "person", true);
        expect(person.startsWith("M 90 193")).toBe(true);
        expect(person.endsWith("322 51")).toBe(true);
    });
    it("全局折叠不丢外部依赖、角色与关联笔数，共享实体只保留一个节点", () => {
        const data = history(30, 4, 8, 5);
        const graph = buildGlobalRelationGraph(
            data.nodes,
            data.edges,
            new Set(["bom", "customer", "person", "order", "inbound", "outbound"]),
        );
        expect(graph.nodes).toHaveLength(32);
        expect(graph.points.size).toBe(32);
        expect(graph.edges).toHaveLength(60);
        expect(
            graph.edges.find(edge => edge.source === "customer:shared" && edge.target === "family:bom:0")?.relation,
        ).toBe("关联 ×4");
        expect(graph.edges.find(edge => edge.source === "person:1" && edge.target === "family:bom:0")?.relation).toBe(
            "关联 ×33",
        );
        const reversed = buildGlobalRelationGraph(
            [...data.nodes].reverse(),
            [...data.edges].reverse(),
            new Set(["bom", "customer", "person", "order", "inbound", "outbound"]),
        );
        expect(reversed).toEqual(graph);
    });
    it("共享客户和人员保留真实实体，不合并不同BOM；输入顺序不影响型号和单据顺序", () => {
        const { nodes, edges } = history(30, 4, 8, 5);
        const result = buildRelationFamilies(nodes, edges);
        const reversed = buildRelationFamilies([...nodes].reverse(), [...edges].reverse());
        expect(result.families).toHaveLength(30);
        expect(
            result.families.map(family => [
                family.id,
                family.orders,
                family.inbounds,
                family.outbounds,
                family.customers,
                family.people,
            ]),
        ).toEqual(
            reversed.families.map(family => [
                family.id,
                family.orders,
                family.inbounds,
                family.outbounds,
                family.customers,
                family.people,
            ]),
        );
        expect(result.byId.size).toBe(nodes.length);
        expect(result.owners.get("customer:shared")?.size).toBe(30);
        expect(result.families[0].people).toHaveLength(1);
    });
    it("按入库、BOM、订单、出库分列，兄弟节点不重叠，出库紧邻真实订单", () => {
        const { nodes, edges } = history(1, 3, 6, 4);
        const business = nodes.filter(item => item.type !== "customer" && item.type !== "person");
        const layout = buildRelationLayout(business, edges);
        expect(buildRelationLayout([...business].reverse(), [...edges].reverse())).toEqual(layout);
        expect(layout.size).toBe(business.length);
        for (const order of business.filter(item => item.type === "order")) {
            const point = layout.get(order.id)!;
            expect(point[0]).toBeGreaterThan(layout.get("bom:0")![0] + RELATION_CARD.width);
            for (const shipment of business.filter(
                item => item.facts.type === "outbound" && item.facts.orderId === order.id,
            ))
                expect(layout.get(shipment.id)![0]).toBeGreaterThan(point[0] + RELATION_CARD.width);
        }
        const columns = new Map<number, number[]>();
        for (const [x, y] of layout.values()) {
            const ys = columns.get(x) ?? [];
            ys.push(y);
            columns.set(x, ys);
        }
        for (const ys of columns.values()) {
            ys.sort((a, b) => a - b);
            for (let i = 1; i < ys.length; i++)
                expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(RELATION_CARD.height + 20);
        }
    });
    it("拖动BOM包含所属单据；订单只包含自己的出库，不牵动其他型号和人员", () => {
        const { nodes } = history(2, 2, 2, 3);
        const bom = relationDragIds(nodes, "bom:0");
        expect(bom.size).toBe(11);
        expect(bom.has("person:1")).toBe(false);
        expect(bom.has("bom:1")).toBe(false);
        expect(relationDragIds(nodes, "order:0:1")).toEqual(
            new Set(["order:0:1", "outbound:0:1:0", "outbound:0:1:1", "outbound:0:1:2"]),
        );
        expect(relationDragIds(nodes, "missing").size).toBe(0);
    });
    it("隐藏父节点后单据仍有确定坐标，窄屏保留可读缩放下限", () => {
        const { nodes, edges } = history(1, 2, 6, 3);
        const leaves = nodes.filter(item => item.type === "inbound" || item.type === "outbound");
        const layout = buildRelationLayout(leaves, edges);
        expect(layout.size).toBe(leaves.length);
        expect([...layout.values()].flat().every(Number.isFinite)).toBe(true);
        expect(fitRelationView(layout, 375, 480).scale).toBeGreaterThanOrEqual(0.7);
        expect(buildRelationLayout([], [])).toEqual(new Map());
    });
    it("客户负责人通过真实客户关系加入上下文，无效边不会引入实体", () => {
        const { nodes, edges } = history(1, 1, 0, 0);
        nodes.push(node("person", "person:owner"));
        edges.push(edge("person:owner", "customer:shared", "person"), edge("missing", "bom:0"));
        const result = buildRelationFamilies(nodes, edges);
        expect(result.families[0].people.map(item => item.id)).toContain("person:owner");
        expect(result.byId.has("missing")).toBe(false);
    });
});
