/* 三类业务凭证共用的边界样本：长规格、长备注与实际数量状态。 */
import type { Bom, InboundRow, Order, OutboundRow, Snapshot } from "@/api";
import { EMPTY_SNAPSHOT } from "@/data/views";

export const detailBom: Bom = {
    code: "ZMKQ006",
    name: "琴键开关",
    modelCode: "KQ-6",
    spec: "旧的拼接规格摘要",
    unit: "件",
    created: "2026-09-13",
    specs: {
        类型: "冷风扇琴键（透明大功率带触点）",
        卡板: "小卡板18mm+大卡板18mm",
        弹簧: "0.35",
        触点: "带点",
        五金件明细: "扣板×2+连锁片+带点静片+带点动片+辅助动片",
    },
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
    state: "printed",
    version: 1,
    printVersion: 1,
};
export const detailSnapshot: Snapshot = {
    ...EMPTY_SNAPSHOT,
    boms: [detailBom],
    orders: [detailOrder],
    stock: { [detailBom.code]: 200 },
    inboundLedger: [detailInbound],
    outboundLedger: [detailOutbound],
};
