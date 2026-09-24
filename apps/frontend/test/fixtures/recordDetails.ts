/* 三类业务凭证共用的边界样本：多物料 BOM、长备注与实际数量状态。 */
import type { Bom, InboundRow, Order, OutboundRow, Snapshot } from "@/api";
import { EMPTY_SNAPSHOT } from "@/data/views";

export const detailBom: Bom = {
    code: "KW042",
    name: "新微动",
    modelCode: "",
    spec: "底座：二脚底座（无挡脚） · 盖子：盖子 · 按钮：8.5mm · 支架：6.3支架：铜镀银 · 静片：6.3静片：铜镀银",
    remark: "",
    unit: "个",
    created: "2026-09-13",
    items: [
        { materialId: "3101", groupKey: "base", groupName: "底座", name: "二脚底座（无挡脚）", quantity: 1 },
        { materialId: "3103", groupKey: "cover", groupName: "盖子", name: "盖子", quantity: 1 },
        { materialId: "3109", groupKey: "button", groupName: "按钮", name: "8.5mm", quantity: 1 },
        { materialId: "3112", groupKey: "bracket", groupName: "支架", name: "6.3支架：铜镀银", quantity: 1 },
        { materialId: "3117", groupKey: "static-plate", groupName: "静片", name: "6.3静片：铜镀银", quantity: 1 },
    ],
};
export const detailOrder: Order = {
    version: 1,
    orderNo: "ZM260913001",
    customer: "深圳市智造联调电子",
    customerCode: "CUS-0002",
    bomCode: detailBom.code,
    qty: 300,
    outbound: 200,
    orderDate: "2026-09-13",
    deliverDate: "2026-09-30",
    remark: "请按型号分箱，随货附出库单。",
    lifecycleStatus: "active",
    createdBy: "梁静",
    createdAt: "2026-09-13T02:05:00Z",
};
export const detailInbound: InboundRow = {
    no: "RK26091301",
    bomCode: detailBom.code,
    qty: 200,
    date: "2026-09-13",
    time: "09-13 10:13",
    inspector: "仓库乙",
    remark: "检验合格，按型号分区存放。",
    status: "active",
    version: 1,
    createdAt: "2026-09-13T02:13:00Z",
};
export const detailOutbound: OutboundRow = {
    no: "CK26091301",
    orderNo: detailOrder.orderNo,
    customer: detailOrder.customer,
    customerCode: detailOrder.customerCode,
    bomCode: detailBom.code,
    qty: 200,
    date: "2026-09-13",
    time: "09-13 10:30",
    operator: "仓库乙",
    remark: "随货附出库单，请核对型号与数量。",
    state: "registered",
    version: 1,
};
export const detailSnapshot: Snapshot = {
    ...EMPTY_SNAPSHOT,
    boms: [detailBom],
    orders: [detailOrder],
    stock: { [detailBom.code]: 200 },
    inboundLedger: [detailInbound],
    outboundLedger: [detailOutbound],
};
