import type { RelationEdge, RelationNode } from "@/data/relations";

export type RelationPoint = [number, number];
export const RELATION_CARD = { width: 180, height: 68, row: 88, column: 232 };
export const RELATION_PAGE = { inbound: 6, order: 3, outbound: 4 };

export interface RelationFamily {
    id: string;
    bom?: RelationNode;
    nodes: RelationNode[];
    inbounds: RelationNode[];
    orders: RelationNode[];
    outbounds: RelationNode[];
    customers: RelationNode[];
    people: RelationNode[];
}

export function relationOwner(node: RelationNode): string | null {
    if (node.facts.type === "bom") return node.id;
    return "bomId" in node.facts ? node.facts.bomId : null;
}

const compare = (a: RelationNode, b: RelationNode) => {
    const aDate = "date" in a.facts ? a.facts.date : "";
    const bDate = "date" in b.facts ? b.facts.date : "";
    return (
        aDate.localeCompare(bDate) ||
        a.name.localeCompare(b.name, "zh-CN", { numeric: true }) ||
        a.id.localeCompare(b.id)
    );
};

/** Shared customers/staff describe a family without creating cross-family lines or duplicate entities. */
export function buildRelationFamilies(nodes: RelationNode[], edges: RelationEdge[]) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const families = new Map<string, RelationFamily>();
    const owners = new Map<string, Set<string>>();
    for (const node of nodes) {
        const id = relationOwner(node);
        if (!id) continue;
        owners.set(node.id, new Set([id]));
        let family = families.get(id);
        if (!family) {
            family = { id, nodes: [], inbounds: [], orders: [], outbounds: [], customers: [], people: [] };
            families.set(id, family);
        }
        family.nodes.push(node);
        if (node.type === "bom") family.bom = node;
        if (node.type === "inbound") family.inbounds.push(node);
        if (node.type === "order") family.orders.push(node);
        if (node.type === "outbound") family.outbounds.push(node);
    }
    const context = new Map<string, Set<string>>();
    for (const edge of edges) {
        for (const [entityId, businessId] of [
            [edge.source, edge.target],
            [edge.target, edge.source],
        ]) {
            const entity = byId.get(entityId),
                business = byId.get(businessId);
            if (!entity || !business || (entity.type !== "customer" && entity.type !== "person")) continue;
            const owner = relationOwner(business);
            if (!owner) continue;
            const ids = context.get(owner) ?? new Set<string>();
            ids.add(entityId);
            context.set(owner, ids);
            const related = owners.get(entityId) ?? new Set<string>();
            related.add(owner);
            owners.set(entityId, related);
        }
    }
    // A customer's owner may have no direct business edge. Include that real one-hop context as well.
    for (const edge of edges) {
        for (const [personId, customerId] of [
            [edge.source, edge.target],
            [edge.target, edge.source],
        ]) {
            if (byId.get(personId)?.type !== "person" || byId.get(customerId)?.type !== "customer") continue;
            for (const owner of owners.get(customerId) ?? []) {
                context.get(owner)?.add(personId);
                const related = owners.get(personId) ?? new Set<string>();
                related.add(owner);
                owners.set(personId, related);
            }
        }
    }
    for (const family of families.values()) {
        for (const id of context.get(family.id) ?? []) {
            const node = byId.get(id)!;
            family.nodes.push(node);
            (node.type === "customer" ? family.customers : family.people).push(node);
        }
        for (const list of [family.inbounds, family.orders, family.outbounds, family.customers, family.people])
            list.sort(compare);
    }
    const sorted = [...families.values()].sort((a, b) =>
        (a.bom?.name ?? a.id).localeCompare(b.bom?.name ?? b.id, "zh-CN", { numeric: true }),
    );
    return { families: sorted, owners, byId };
}

/** Four readable columns; an expanded order reserves space for its actual shipments. O(n log n + e). */
export function buildRelationLayout(nodes: RelationNode[], _edges: RelationEdge[]) {
    const points = new Map<string, RelationPoint>();
    const { column, row } = RELATION_CARD;
    const receipts = nodes.filter(node => node.type === "inbound").sort(compare);
    const orders = nodes.filter(node => node.type === "order").sort(compare);
    const shipments = nodes.filter(node => node.type === "outbound").sort(compare);
    const byOrder = new Map<string, RelationNode[]>();
    for (const node of shipments) {
        if (node.facts.type !== "outbound") continue;
        const siblings = byOrder.get(node.facts.orderId) ?? [];
        siblings.push(node);
        byOrder.set(node.facts.orderId, siblings);
    }
    let cursor = 0;
    for (const order of orders) {
        const children = byOrder.get(order.id) ?? [];
        const rows = Math.max(1, children.length);
        points.set(order.id, [column * 2, cursor + ((rows - 1) * row) / 2]);
        children.forEach((child, i) => points.set(child.id, [column * 3, cursor + i * row]));
        cursor += rows * row;
    }
    const loose = shipments.filter(node => !points.has(node.id));
    loose.forEach((node, i) => points.set(node.id, [column * 3, cursor + i * row]));
    const rightHeight = cursor + loose.length * row;
    const height = Math.max(row, receipts.length * row, rightHeight);
    for (const node of nodes) if (node.type === "bom") points.set(node.id, [column, (height - row) / 2]);
    receipts.forEach((node, i) => points.set(node.id, [0, i * row + (height - receipts.length * row) / 2]));
    for (const [id, point] of points) {
        if (point[0] >= column * 2) points.set(id, [point[0], point[1] + (height - rightHeight) / 2]);
    }
    const customers = nodes.filter(node => node.type === "customer").sort(compare);
    const people = nodes.filter(node => node.type === "person").sort(compare);
    customers.forEach((node, i) => points.set(node.id, [column * 2 + i * column, -row - 16]));
    people.forEach((node, i) => points.set(node.id, [i * column, height]));
    return points;
}

/** A BOM moves its visible business family; an order moves only its own shipments. */
export function relationDragIds(nodes: RelationNode[], id: string) {
    const node = nodes.find(item => item.id === id);
    if (!node) return new Set<string>();
    return new Set(
        nodes
            .filter(
                item =>
                    item.id === id ||
                    (node.type === "bom" && relationOwner(item) === id) ||
                    (node.type === "order" && item.facts.type === "outbound" && item.facts.orderId === id),
            )
            .map(item => item.id),
    );
}

export function relationEdgePath(
    source: RelationPoint,
    target: RelationPoint,
    kind: "business" | "person" = "business",
    compact = false,
) {
    const { width, height } = RELATION_CARD;
    if (kind === "person") {
        const x1 = source[0] + width / 2,
            y1 = source[1] + (compact ? height / 2 - 17 : 0);
        const x2 = target[0] + width / 2,
            y2 = target[1] + (compact ? height / 2 + 17 : height);
        return `M ${x1} ${y1} C ${x1} ${y1 - 44}, ${x2} ${y2 + 44}, ${x2} ${y2}`;
    }
    if (source[0] === target[0]) {
        const [top, bottom] = source[1] <= target[1] ? [source, target] : [target, source];
        const port = compact ? width / 2 - 17 : 0;
        const lane = top[0] + port - 28;
        return `M ${top[0] + port} ${top[1] + height / 2} H ${lane} V ${bottom[1] + height / 2} H ${bottom[0] + port}`;
    }
    const [left, right] = source[0] <= target[0] ? [source, target] : [target, source];
    const x1 = left[0] + (compact ? width / 2 + 17 : width),
        y1 = left[1] + height / 2;
    const x2 = right[0] + (compact ? width / 2 - 17 : 0),
        y2 = right[1] + height / 2;
    const middle = (x1 + x2) / 2;
    return `M ${x1} ${y1} H ${middle} V ${y2} H ${x2}`;
}

export function relationNodeSummary(node: RelationNode, byId?: Map<string, RelationNode>) {
    const facts = node.facts;
    switch (facts.type) {
        case "bom":
            return `当前库存 ${facts.stock} ${facts.unit}`;
        case "order":
            return byId?.get(facts.customerId)?.name ?? `待交 ${facts.pendingQty} ${facts.unit}`;
        case "inbound":
        case "outbound":
            return `${facts.date.slice(5)} · ${facts.qty} ${facts.unit}${facts.voided ? " · 作废" : ""}`;
        case "customer":
            return `客户编号 ${facts.code}`;
        case "person":
            return node.properties.角色 ?? facts.role;
    }
}

/** Global dependency view folds business documents into their BOM, retaining every external relationship and role. */
export function buildGlobalRelationGraph(
    nodes: RelationNode[],
    edges: RelationEdge[],
    enabled: Set<RelationNode["type"]>,
) {
    const index = buildRelationFamilies(nodes, edges);
    const targets = new Map<string, string>(),
        familyIds = new Map<string, string>(),
        summaries = new Map<string, string>();
    const graphNodes: RelationNode[] = [];
    const roots: RelationNode[] = [];
    for (const family of index.families) {
        const business = family.nodes.filter(node => relationOwner(node) && enabled.has(node.type));
        if (!business.length) continue;
        const id = `family:${family.id}`,
            name = family.bom?.name ?? "关联型号";
        const root: RelationNode = {
            id,
            name,
            type: "bom",
            facts: { type: "bom", code: name, unit: "", stock: 0, createdById: "" },
            properties: {},
        };
        roots.push(root);
        graphNodes.push(root);
        familyIds.set(id, family.id);
        summaries.set(
            id,
            `入 ${enabled.has("inbound") ? family.inbounds.length : "—"} · 订 ${enabled.has("order") ? family.orders.length : "—"} · 出 ${enabled.has("outbound") ? family.outbounds.length : "—"}`,
        );
        for (const node of business) targets.set(node.id, id);
    }
    const contextNodes = nodes.filter(node => !relationOwner(node) && enabled.has(node.type)).sort(compare);
    for (const node of contextNodes) {
        graphNodes.push(node);
        targets.set(node.id, node.id);
        summaries.set(node.id, relationNodeSummary(node));
    }
    const grouped = new Map<
        string,
        { source: string; target: string; kind: RelationEdge["kind"]; roles: Map<string, number> }
    >();
    for (const edge of edges) {
        const source = targets.get(edge.source),
            target = targets.get(edge.target);
        if (!source || !target || source === target) continue;
        const key = `${source}|${target}|${edge.kind}`;
        const group = grouped.get(key) ?? { source, target, kind: edge.kind, roles: new Map<string, number>() };
        group.roles.set(edge.relation, (group.roles.get(edge.relation) ?? 0) + 1);
        grouped.set(key, group);
    }
    const graphEdges: RelationEdge[] = [...grouped.values()]
        .map(group => ({
            source: group.source,
            target: group.target,
            kind: group.kind,
            relation: [...group.roles]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([role, count]) => `${role}${count > 1 ? ` ×${count}` : ""}`)
                .join("、"),
        }))
        .sort(
            (a, b) =>
                a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.kind.localeCompare(b.kind),
        );
    const columns = Math.max(1, Math.ceil(Math.sqrt(roots.length * 0.7)));
    const rowHeight = 104,
        columnWidth = 216;
    const height = Math.max(
        rowHeight,
        Math.ceil(roots.length / columns) * rowHeight,
        ...["customer", "person"].map(type => contextNodes.filter(node => node.type === type).length * rowHeight),
    );
    const points = new Map<string, RelationPoint>();
    roots.forEach((node, i) =>
        points.set(node.id, [
            464 + (i % columns) * columnWidth,
            Math.floor(i / columns) * rowHeight + (height - Math.ceil(roots.length / columns) * rowHeight) / 2,
        ]),
    );
    const adjacent = new Map<string, number[]>();
    for (const edge of graphEdges) {
        const point = points.get(edge.target);
        if (point) {
            const values = adjacent.get(edge.source) ?? [];
            values.push(point[1]);
            adjacent.set(edge.source, values);
        }
    }
    const mean = (id: string) => {
        const values = adjacent.get(id) ?? [];
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : height / 2;
    };
    for (const type of ["person", "customer"] as const) {
        const lane = contextNodes
            .filter(node => node.type === type)
            .sort((a, b) => mean(a.id) - mean(b.id) || compare(a, b));
        lane.forEach((node, i) =>
            points.set(node.id, [
                type === "person" ? 0 : 232,
                ((height - RELATION_CARD.height) * (i + 0.5)) / Math.max(1, lane.length),
            ]),
        );
    }
    return { nodes: graphNodes, edges: graphEdges, points, familyIds, summaries };
}
