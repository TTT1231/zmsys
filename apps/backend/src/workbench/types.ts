/** 工作台聚合读模型（契约 workbench tag）：与前端 WorkbenchData 同构，
 * 前端据此派生周期汇总、交付风险、客户排行与出入库趋势。 */

export interface WorkbenchProduct {
    code: string;
    category: string;
    model: string;
    spec: string;
    unit: string;
    stock: number;
}

export interface WorkbenchOrder {
    no: string;
    customerCode: string;
    customer: string;
    bomCode: string;
    date: string;
    due: string;
    qty: number;
    shipped: number;
    cancelled?: boolean;
    archived?: boolean;
}

export interface WorkbenchMovement {
    date: string;
    bomCode: string;
    inbound: number;
    outbound: number;
}

/** 数量跨 BOM 汇总，单一计量单位时才具备精确含义 */
export interface WorkbenchData {
    asOf: string;
    unit: string;
    products: WorkbenchProduct[];
    orders: WorkbenchOrder[];
    movements: WorkbenchMovement[];
}
