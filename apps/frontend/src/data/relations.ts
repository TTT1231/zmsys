/** 分析页关系图只读契约；稳定实体 ID 避免同名人员/客户合并。 */
export type RelationType = "bom" | "customer" | "order" | "inbound" | "outbound" | "person";
export type RelationStatus = "open" | "completed" | "archived" | "all";

/** 可供 agent 直接计算的原始字段；关联 ID 均指向 nodes.id，数值不带展示单位。 */
export type RelationFacts =
    | { type: "bom"; code: string; unit: string; stock: number; createdById: string }
    | { type: "customer"; code: string; ownerId: string }
    | {
          type: "order";
          no: string;
          date: string;
          due: string;
          qty: number;
          shipped: number;
          unshippedQty: number;
          pendingQty: number;
          archived: boolean;
          unit: string;
          bomId: string;
          customerId: string;
          createdById: string;
          archivedById: string | null;
      }
    | {
          type: "inbound";
          no: string;
          date: string;
          qty: number;
          voided: boolean;
          unit: string;
          bomId: string;
          operatorId: string;
      }
    | {
          type: "outbound";
          no: string;
          date: string;
          qty: number;
          voided: boolean;
          unit: string;
          bomId: string;
          orderId: string;
          operatorId: string;
      }
    | { type: "person"; role: string };

export interface RelationNode {
    id: string;
    type: RelationType;
    name: string;
    properties: Record<string, string>;
    facts: RelationFacts;
    voided?: boolean;
}

export interface RelationEdge {
    source: string;
    target: string;
    relation: string;
    kind: "business" | "person";
}

export interface RelationsData {
    schemaVersion: 1;
    asOf: string;
    generatedAt: string;
    filters: {
        status: RelationStatus;
        start: string | null;
        end: string | null;
        types: RelationType[];
        orderNo: string | null;
        bomCode: string | null;
        customerCode: string | null;
    };
    nodes: RelationNode[];
    edges: RelationEdge[];
    counts: Record<RelationStatus, number>;
    typeCounts: Record<RelationType, number>;
    summary: {
        orderCount: number;
        overdueOrderIds: string[];
        quantitiesByUnit: { unit: string; ordered: number; shipped: number; pending: number }[];
    };
}

export const RELATION_TYPES: { key: RelationType; name: string }[] = [
    { key: "bom", name: "BOM" },
    { key: "customer", name: "客户" },
    { key: "order", name: "销售订单" },
    { key: "inbound", name: "入库" },
    { key: "outbound", name: "出库" },
    { key: "person", name: "人员" },
];
