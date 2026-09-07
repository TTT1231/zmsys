export type StatusKey = "done" | "progress" | "ready" | "pending";

export interface OrderStatus {
  label: string;
  key: StatusKey;
}

export interface Order {
  orderNo: string;
  customer: string;
  customerCode: string;
  bomCode: string;
  qty: number;
  outbound: number;
  orderDate: string;
  deliverDate: string;
  productMode: "generic" | "custom";
  remark: string;
}

export interface Bom {
  code: string;
  modelCode: string;
  seriesLabel: string;
  gear: string;
  gearSpec: string;
  gearDir: string;
  thickness: string;
  spring: string;
  spec: string;
  productCode: string;
  custom: boolean;
  remark: string;
  created: string;
  name: string;
  model: string;
  unit: string;
}

export interface Customer {
  code: string;
  name: string;
  contact: string;
  phone: string;
  phoneFull: string;
  region: string;
  city: string;
  address: string;
  status: "合作中" | "待跟进";
  owner: string;
  payTerms: string;
  created: string;
}

export interface InboundRow {
  no: string;
  bomCode: string;
  productCode: string;
  qty: number;
  date: string;
  time: string;
  inspector: string;
  remark?: string;
}

export interface OutboundRow {
  no: string;
  orderNo: string;
  customer: string;
  customerCode: string;
  bomCode: string;
  productCode: string;
  qty: number;
  date: string;
  time: string;
  operator: string;
  remark?: string;
}

export interface WbUser {
  name: string;
  role: string;
  account: string;
}

export interface SystemEvent {
  level: string;
  levelTone: "danger" | "warning" | "info" | "neutral";
  module: string;
  item: string;
  ref: string;
  found: string;
  state: string;
  open: boolean;
}

export interface OpLogEntry {
  date: string;
  time: string;
  user: string;
  role: string;
  action: string;
  target: string;
}

export interface Snapshot {
  version: number;
  orders: Order[];
  boms: Bom[];
  customers: Customer[];
  inboundLedger: InboundRow[];
  outboundLedger: OutboundRow[];
  stock: Record<string, number>;
}

export interface ReadyToShipRow {
  orderNo: string;
  customer: string;
  customerCode: string;
  bomCode: string;
  productCode: string;
  bomLabel: string;
  deliverDate: string;
  remaining: number;
  stock: number;
  maxShip: number;
  status: OrderStatus;
  overdue: boolean;
}

export interface PendingVsStockRow {
  id: string;
  customer: string;
  productCode: string;
  bomLabel: string;
  productType: string;
  version: string;
  deliverDate: string;
  ordered: number;
  shipped: number;
  remaining: number;
  stock: number;
  maxShip: number;
  overdue: boolean;
}

export interface RiskOrderRow {
  orderNo: string;
  customer: string;
  customerCode: string;
  productCode: string;
  bomLabel: string;
  deliverDate: string;
  qty: number;
  outbound: number;
  remaining: number;
  stock: number;
  maxShip: number;
  overdue: boolean;
}

export interface StockGapRow {
  bomCode: string;
  productCode: string;
  gapQty: number;
  demandQty: number;
  stockQty: number;
  orderCount: number;
  earliestDate: string;
  earliestOrderNo: string;
  earliestCustomer: string;
  earliestOverdue: boolean;
}

export interface TrendRow {
  date: string;
  label: string;
  orderedQty: number;
  orderedCount: number;
  inboundQty: number;
  inboundCount: number;
  outboundQty: number;
  outboundCount: number;
}

export interface TopCustomerRow {
  customer: string;
  customerCode: string;
  orderCount: number;
  totalQty: number;
  outboundQty: number;
  pendingQty: number;
}
