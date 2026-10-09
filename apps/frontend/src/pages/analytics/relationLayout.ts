import type { RelationEdge, RelationNode, RelationType } from "@/data/relations";

export type RelationPoint = [number, number];
type PositionedGroup = { id: string; points: Map<string, RelationPoint>; width: number; height: number };

const GAP = 72;
const GROUP_GAP = 112;
const compareId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Only business entities own a group. Shared customers/staff never join unrelated BOMs into one giant cluster. */
const businessGroup = (node: RelationNode): string | null => {
    switch (node.facts.type) {
        case "bom":
            return node.id;
        case "order":
        case "inbound":
        case "outbound":
            return node.facts.bomId;
        default:
            return null;
    }
};

/** Stable shelf packing: no iterative force simulation or pairwise collision scan. */
const pack = (groups: PositionedGroup[], aspect: number, gap: number): PositionedGroup => {
    const points = new Map<string, RelationPoint>();
    if (!groups.length) return { id: "", points, width: GAP, height: GAP };
    const area = groups.reduce((sum, group) => sum + (group.width + gap) * (group.height + gap), 0);
    const ordered = [...groups].sort((a, b) => b.height - a.height || compareId(a, b));
    const widest = Math.max(...groups.map(group => group.width));
    const target = Math.sqrt(area * aspect);
    const arrange = (rowWidth: number) => {
        let x = 0,
            y = 0,
            rowHeight = 0,
            width = 0;
        const offsets: RelationPoint[] = [];
        for (const group of ordered) {
            if (x && x + group.width > rowWidth) {
                y += rowHeight + gap;
                x = 0;
                rowHeight = 0;
            }
            offsets.push([x, y]);
            width = Math.max(width, x + group.width);
            rowHeight = Math.max(rowHeight, group.height);
            x += group.width + gap;
        }
        const height = y + rowHeight;
        return { offsets, width, height, score: Math.max(width / aspect, height) };
    };
    // A fixed number of candidates accommodates wide desktop canvases without unbounded bin packing.
    const choices = [0.7, 0.85, 1, 1.2, 1.4, 1.7].map(factor => arrange(Math.max(widest, target * factor)));
    const best = choices.reduce((a, b) => (b.score < a.score ? b : a));
    ordered.forEach((group, index) => {
        const offset = best.offsets[index];
        for (const [id, point] of group.points) points.set(id, [point[0] + offset[0], point[1] + offset[1]]);
    });
    return { id: "", points, width: best.width, height: best.height };
};

const grid = (nodes: RelationNode[], columns: number): PositionedGroup => {
    const width = Math.max(1, Math.min(nodes.length, columns));
    return {
        id: nodes[0]?.id ?? "",
        points: new Map(
            nodes.map((node, i) => [node.id, [(i % width) * GAP + GAP / 2, Math.floor(i / width) * GAP + GAP / 2]]),
        ),
        width: width * GAP,
        height: Math.max(1, Math.ceil(nodes.length / width)) * GAP,
    };
};

const orderFamily = (order: RelationNode, outbounds: RelationNode[]): PositionedGroup => {
    if (!outbounds.length) return grid([order], 1);
    const shipments = grid(outbounds, Math.ceil(Math.sqrt(outbounds.length)));
    const points = new Map<string, RelationPoint>([[order.id, [GAP / 2, shipments.height / 2]]]);
    for (const [id, point] of shipments.points) points.set(id, [point[0] + GAP, point[1]]);
    return { id: order.id, points, width: shipments.width + GAP, height: shipments.height };
};

const neighborOrder = (nodes: RelationNode[], points: Map<string, RelationPoint>, adjacency: Map<string, string[]>) => {
    const meanX = (id: string) => {
        const neighbors = adjacency.get(id) ?? [];
        let sum = 0,
            count = 0;
        for (const neighbor of neighbors) {
            const point = points.get(neighbor);
            if (point) {
                sum += point[0];
                count++;
            }
        }
        return count ? sum / count : 0;
    };
    const centers = new Map(nodes.map(node => [node.id, meanX(node.id)]));
    return [...nodes].sort((a, b) => centers.get(a.id)! - centers.get(b.id)! || compareId(a, b));
};

/**
 * BOM → order → shipment families retain short local edges. Inbounds sit beside their BOM;
 * customers and staff occupy separate tracks, ordered by the positions of their real neighbors.
 * All node placement is bounded by sorting plus linear passes through nodes/edges (O(n log n + e)).
 * The canvas only draws final coordinates, so opening and resetting the same graph is repeatable.
 */
export function buildRelationLayout(nodes: RelationNode[], edges: RelationEdge[], aspectRatio = 1.7) {
    const sorted = [...nodes].sort(compareId);
    const aspect = Math.max(0.6, Math.min(5, aspectRatio));
    const groups = new Map<string, RelationNode[]>();
    const groupByNode = new Map<string, string>();
    const adjacency = new Map<string, string[]>();
    const ids = new Set(sorted.map(node => node.id));
    for (const node of sorted) {
        const group = businessGroup(node);
        if (!group) continue;
        groupByNode.set(node.id, group);
        const members = groups.get(group) ?? [];
        members.push(node);
        groups.set(group, members);
    }
    for (const edge of edges) {
        if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
        const source = adjacency.get(edge.source) ?? [];
        source.push(edge.target);
        adjacency.set(edge.source, source);
        const target = adjacency.get(edge.target) ?? [];
        target.push(edge.source);
        adjacency.set(edge.target, target);
    }
    const shared: RelationNode[] = [];
    for (const node of sorted) {
        if (groupByNode.has(node.id)) continue;
        const owners = new Set(
            (adjacency.get(node.id) ?? []).map(id => groupByNode.get(id)).filter(id => id !== undefined),
        );
        const owner = owners.size === 1 ? owners.values().next().value : undefined;
        if (owner) groups.get(owner)!.push(node);
        else shared.push(node);
    }

    const blocks: PositionedGroup[] = [];
    for (const [id, members] of [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        const orders = members.filter(node => node.type === "order");
        const orderIds = new Set(orders.map(node => node.id));
        const shipments = new Map<string, RelationNode[]>();
        const loose: RelationNode[] = [];
        for (const node of members) {
            if (node.facts.type !== "outbound") continue;
            if (!orderIds.has(node.facts.orderId)) loose.push(node);
            else {
                const siblings = shipments.get(node.facts.orderId) ?? [];
                siblings.push(node);
                shipments.set(node.facts.orderId, siblings);
            }
        }
        const families = orders.map(order => orderFamily(order, shipments.get(order.id) ?? []));
        if (loose.length) families.push(grid(loose, Math.ceil(Math.sqrt(loose.length))));
        const business = pack(families, Math.min(2, aspect), GAP / 2);
        const inbounds = members.filter(node => node.type === "inbound");
        const receipts = grid(inbounds, Math.max(1, Math.ceil(Math.sqrt(inbounds.length))));
        const hasBom = members.some(node => node.type === "bom");
        const receiptsWidth = inbounds.length ? receipts.width + GAP / 2 : 0;
        const spineWidth = hasBom ? GAP + GAP / 2 : 0;
        const points = new Map<string, RelationPoint>();
        let width = receiptsWidth + spineWidth + (families.length ? business.width : 0);
        let height = Math.max(GAP, inbounds.length ? receipts.height : 0, families.length ? business.height : 0);
        for (const node of members) {
            if (node.type === "bom") points.set(node.id, [receiptsWidth + GAP / 2, height / 2]);
        }
        if (inbounds.length)
            for (const [nodeId, point] of receipts.points)
                points.set(nodeId, [point[0], point[1] + (height - receipts.height) / 2]);
        for (const [nodeId, point] of business.points)
            points.set(nodeId, [point[0] + receiptsWidth + spineWidth, point[1] + (height - business.height) / 2]);

        const customers = neighborOrder(
            members.filter(node => node.type === "customer"),
            points,
            adjacency,
        );
        const staff = neighborOrder(
            members.filter(node => node.type === "person"),
            points,
            adjacency,
        );
        // A narrow family still reserves enough space for its local customer/staff tracks.
        width = Math.max(width, Math.min(4, Math.max(customers.length, staff.length)) * GAP, GAP);
        const columns = Math.max(1, Math.floor(width / GAP));
        const customerTrack = grid(customers, columns);
        const customerHeight = customers.length ? customerTrack.height + GAP / 2 : 0;
        for (const point of points.values()) point[1] += customerHeight;
        for (const [nodeId, point] of customerTrack.points)
            points.set(nodeId, [point[0] + (width - customerTrack.width) / 2, point[1]]);
        height += customerHeight;
        const staffTrack = grid(staff, columns);
        if (staff.length) {
            for (const [nodeId, point] of staffTrack.points)
                points.set(nodeId, [point[0] + (width - staffTrack.width) / 2, point[1] + height + GAP / 2]);
            height += staffTrack.height + GAP / 2;
        }
        blocks.push({ id, points, width, height });
    }
    const packed = pack(blocks, aspect, GROUP_GAP);
    const sharedCustomers = neighborOrder(
        shared.filter(node => node.type === "customer"),
        packed.points,
        adjacency,
    );
    const sharedStaff = neighborOrder(
        shared.filter(node => node.type === "person"),
        packed.points,
        adjacency,
    );
    const sharedCount = Math.max(sharedCustomers.length, sharedStaff.length);
    const width = Math.max(packed.width, Math.min(12, Math.ceil(Math.sqrt(sharedCount * aspect))) * GAP);
    const columns = Math.max(1, Math.floor(width / GAP));
    const customers = grid(sharedCustomers, columns);
    const top = sharedCustomers.length ? customers.height + GROUP_GAP : 0;
    const points = new Map<string, RelationPoint>();
    for (const [id, point] of packed.points) points.set(id, [point[0] + (width - packed.width) / 2, point[1] + top]);
    for (const [id, point] of customers.points) points.set(id, [point[0] + (width - customers.width) / 2, point[1]]);
    const staff = grid(sharedStaff, columns);
    for (const [id, point] of staff.points)
        points.set(id, [point[0] + (width - staff.width) / 2, point[1] + top + packed.height + GROUP_GAP]);
    return points;
}

/** At overview zoom, screen-space circles fit inside the smallest grid cell even after contain scaling. */
export function relationSymbolScale(
    points: Map<string, RelationPoint>,
    width: number,
    height: number,
    nodeCount: number,
) {
    const values = [...points.values()];
    if (values.length < 2) return 1;
    const x = values.map(point => point[0]),
        y = values.map(point => point[1]);
    const scale = Math.min(
        Math.max(1, width - 160) / Math.max(GAP, Math.max(...x) - Math.min(...x)),
        Math.max(1, height - 135) / Math.max(GAP, Math.max(...y) - Math.min(...y)),
    );
    const density = nodeCount > 600 ? 0.55 : nodeCount > 300 ? 0.68 : nodeCount > 120 ? 0.82 : 1;
    return Math.min(density, (GAP * 0.6 * scale) / 51);
}

/** Keep small ledgers visible without letting their minimum size exceed the screen-space spacing cap. */
export function relationNodeVisual(baseSize: number, scale: number, voided = false) {
    const cap = 51 * scale;
    const symbolSize = Math.min(cap, Math.max(baseSize * scale, Math.min(4, cap * 0.55)));
    const borderWidth = symbolSize <= 8 ? Math.min(0.4, symbolSize * 0.08) : voided ? 2 : 1.5;
    return { symbolSize, borderWidth };
}

const labelRank: Record<RelationType, number> = { bom: 0, customer: 1, order: 2, person: 3, inbound: 4, outbound: 5 };

/** Dense histories get a small overview label budget; selection reveals only a bounded neighborhood. */
export function relationLabelIds(
    nodes: RelationNode[],
    edges: RelationEdge[],
    selected: string | null,
    viewport?: { width: number; height: number },
) {
    const ranked = [...nodes].sort((a, b) => labelRank[a.type] - labelRank[b.type] || compareId(a, b));
    const count = nodes.length;
    const availableArea = viewport ? Math.max(1, viewport.width - 100) * Math.max(1, viewport.height - 100) : Infinity;
    const overviewBudget = Math.min(
        count <= 70 ? 70 : count <= 180 ? 90 : count <= 400 ? 50 : 24,
        Math.max(6, Math.floor(availableArea / 11000)),
    );
    const labels = new Set(
        ranked
            .filter(node => count <= 70 || (count <= 180 ? labelRank[node.type] <= 2 : labelRank[node.type] <= 1))
            .slice(0, overviewBudget)
            .map(node => node.id),
    );
    if (selected) {
        labels.add(selected);
        const neighbors = new Set<string>();
        for (const edge of edges) {
            if (edge.source === selected) neighbors.add(edge.target);
            if (edge.target === selected) neighbors.add(edge.source);
        }
        const neighborBudget = Math.min(36, Math.max(8, Math.floor(availableArea / 8000)));
        for (const node of ranked.filter(node => neighbors.has(node.id)).slice(0, neighborBudget)) labels.add(node.id);
    }
    return labels;
}
