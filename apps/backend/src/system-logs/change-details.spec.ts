/** 系统日志变更提取：各动作 detail 快照 → 中文变更列表的口径单测 */
import { describe, expect, it } from "vitest";
import {
    changesOfAdjustment,
    changesOfInboundEdit,
    changesOfOpLog,
    changesOfOrderEdit,
    reasonText,
} from "./change-details";

describe("changesOfOpLog", () => {
    it("create_order：客户/BOM 冻结快照/数量/交期关键事实（before=null，数量带单位）", () => {
        expect(
            changesOfOpLog("create_order", {
                orderNo: "ZM260927001",
                qty: 240,
                deliverDate: "2026-10-18",
                remark: "",
                lifecycleStatus: "ACTIVE",
                customer: "华辰电器",
                bomCode: "ZMKW0001",
                bomName: "新微动",
                bomModel: "KW-2A",
                bomRemark: "带挡脚版本，注意区分",
                bomSpec: {
                    items: [
                        {
                            materialId: "9001",
                            groupKey: "base",
                            groupName: "底座",
                            name: "三脚底座（有挡脚）",
                            position: 1,
                            quantity: 1,
                        },
                        {
                            materialId: "9002",
                            groupKey: "button",
                            groupName: "按钮",
                            name: "8.5mm",
                            position: 2,
                            quantity: 1,
                        },
                    ],
                    modelCode: "KW-2A",
                    spec: "底座：三脚底座（有挡脚） · 按钮：8.5mm",
                },
            }),
        ).toEqual([
            { key: "customer", label: "客户", before: null, after: "华辰电器" },
            { key: "bomCode", label: "BOM 编码", before: null, after: "ZMKW0001" },
            { key: "bomName", label: "成品名称", before: null, after: "新微动" },
            { key: "bomSpec", label: "规格构成", before: null, after: "底座：三脚底座（有挡脚） · 按钮：8.5mm" },
            { key: "bomRemark", label: "BOM 备注", before: null, after: "带挡脚版本，注意区分" },
            { key: "qty", label: "订单数量", before: null, after: "240 个" },
            { key: "deliverDate", label: "交货日期", before: null, after: "2026-10-18" },
        ]);
    });

    it("delete_order：同 create 口径透出 BOM 快照；存量快照缺 spec 时按冻结明细拼装", () => {
        expect(
            changesOfOpLog("delete_order", {
                orderNo: "ZM260927002",
                qty: 100,
                deliverDate: "2026-10-20",
                remark: null,
                lifecycleStatus: "ACTIVE",
                customer: "锦泰科技",
                bomCode: "ZMKW0002",
                bomName: "新微动",
                bomModel: "",
                // 20260922000000 之前的订单快照无 spec 字段，按 items 同规则拼装
                bomSpec: {
                    items: [
                        {
                            materialId: "9003",
                            groupKey: "base",
                            groupName: "底座",
                            name: "三脚底座（有挡脚）",
                            position: 1,
                            quantity: 1,
                        },
                        {
                            materialId: "9004",
                            groupKey: "lever",
                            groupName: "杠杆",
                            name: "中支点",
                            position: 2,
                            quantity: 2,
                        },
                    ],
                    modelCode: "",
                },
                deletedAt: "2026-09-27T10:00:00.000Z",
            }),
        ).toEqual([
            { key: "customer", label: "客户", before: null, after: "锦泰科技" },
            { key: "bomCode", label: "BOM 编码", before: null, after: "ZMKW0002" },
            { key: "bomName", label: "成品名称", before: null, after: "新微动" },
            { key: "bomSpec", label: "规格构成", before: null, after: "底座：三脚底座（有挡脚） · 杠杆：中支点 ×2" },
            { key: "qty", label: "订单数量", before: null, after: "100 个" },
            { key: "deliverDate", label: "交货日期", before: null, after: "2026-10-20" },
        ]);
    });

    it("archive_order：状态由进行中推断为已归档", () => {
        expect(changesOfOpLog("archive_order", { qty: 300, lifecycleStatus: "ARCHIVED" })).toEqual([
            { key: "lifecycleStatus", label: "订单状态", before: "进行中", after: "已归档" },
            { key: "qty", label: "订单数量", before: null, after: "300 个" },
        ]);
    });

    it("update_customer：8 字段 diff、地区四段合并、电话只记是否变更", () => {
        const changes = changesOfOpLog("update_customer", {
            before: {
                name: "华辰电器",
                contactPerson: "陈敏",
                province: "广东省",
                city: "深圳市",
                district: "南山区",
                town: null,
                address: "科技园 1 号",
                payTerms: "月结 30 天",
            },
            after: {
                name: "华辰电器",
                contactPerson: "林悦",
                province: "广东省",
                city: "深圳市",
                district: "南山区",
                town: null,
                address: "科技园 1 号",
                payTerms: "月结 45 天",
            },
            phoneChanged: true,
            ownerChanged: null,
        });
        expect(changes).toEqual([
            { key: "contactPerson", label: "联系人", before: "陈敏", after: "林悦" },
            { key: "payTerms", label: "付款条件", before: "月结 30 天", after: "月结 45 天" },
            { key: "phone", label: "联系电话", before: "原号码不展示", after: "已变更，号码不展示" },
        ]);
    });

    it("update_customer 的 ownerChanged：移交只展示负责销售 from → to", () => {
        expect(
            changesOfOpLog("update_customer", {
                name: "锦泰科技",
                ownerChanged: { from: "周宁", to: "王明" },
                batchId: "9000000000000000",
                reason: "原负责人离岗，统一移交客户",
            }),
        ).toEqual([{ key: "owner", label: "负责销售", before: "周宁", after: "王明" }]);
    });

    it("create_customer：名称与负责销售", () => {
        expect(changesOfOpLog("create_customer", { name: "嘉信电子", ownerAccount: "sales01" })).toEqual([
            { key: "name", label: "客户名称", before: null, after: "嘉信电子" },
            { key: "ownerAccount", label: "负责销售", before: null, after: "sales01" },
        ]);
    });

    it("void_inbound：before/after diff，状态映射有效/已作废", () => {
        expect(
            changesOfOpLog("void_inbound", {
                before: {
                    no: "RK26092701",
                    bomCode: "ZMKW0001",
                    qty: 100,
                    date: "2026-09-27",
                    remark: "",
                    status: "ACTIVE",
                    version: 1,
                },
                after: {
                    no: "RK26092701",
                    bomCode: "ZMKW0001",
                    qty: 100,
                    date: "2026-09-27",
                    remark: "",
                    status: "VOIDED",
                    version: 2,
                },
                reason: "登记数量有误",
            }),
        ).toEqual([{ key: "status", label: "状态", before: "有效", after: "已作废" }]);
    });

    it("ship：发货数量/订单号与备注", () => {
        expect(
            changesOfOpLog("ship", { orderNo: "ZM260927001", qty: 40, remark: "加急", customer: "华辰电器" }),
        ).toEqual([
            { key: "qty", label: "发货数量", before: null, after: "40 个" },
            { key: "orderNo", label: "订单号", before: null, after: "ZM260927001" },
            { key: "remark", label: "备注", before: null, after: "加急" },
        ]);
    });

    it("create_bom：成品名称/规格构成/建档备注", () => {
        expect(
            changesOfOpLog("create_bom", {
                name: "新微动",
                spec: "底座：三脚底座 · 按钮：8.5mm",
                remark: "客户专属定制",
            }),
        ).toEqual([
            { key: "name", label: "成品名称", before: null, after: "新微动" },
            { key: "spec", label: "规格构成", before: null, after: "底座：三脚底座 · 按钮：8.5mm" },
            { key: "remark", label: "备注", before: null, after: "客户专属定制" },
        ]);
    });

    it("未知动作返回 null", () => {
        expect(changesOfOpLog("void_outbound", { qty: 10, orderNo: "ZM1" })).toEqual([
            { key: "qty", label: "出库数量", before: null, after: "10 个" },
            { key: "orderNo", label: "订单号", before: null, after: "ZM1" },
        ]);
        expect(changesOfOpLog("__unknown__", null)).toBeNull();
    });
});

describe("changesOfOrderEdit / changesOfInboundEdit", () => {
    it("订单编辑：qty/deliverDate/remark 逐字段 diff，rowVersion 等技术字段不入目录", () => {
        expect(
            changesOfOrderEdit(
                {
                    orderNo: "ZM260927001",
                    qty: 500,
                    orderDate: "2026-09-27",
                    deliverDate: "2026-10-08",
                    remark: "",
                    lifecycleStatus: "ACTIVE",
                    rowVersion: 1,
                },
                {
                    orderNo: "ZM260927001",
                    qty: 600,
                    orderDate: "2026-09-27",
                    deliverDate: "2026-10-12",
                    remark: "加急",
                    lifecycleStatus: "ACTIVE",
                    rowVersion: 2,
                },
            ),
        ).toEqual([
            { key: "qty", label: "订单数量", before: "500 个", after: "600 个" },
            { key: "deliverDate", label: "交货日期", before: "2026-10-08", after: "2026-10-12" },
            { key: "remark", label: "备注", before: null, after: "加急" },
        ]);
    });

    it("入库修正：数量与备注 diff", () => {
        expect(
            changesOfInboundEdit(
                { no: "RK26092701", bomCode: "ZMKW0001", qty: 100, date: "2026-09-27", remark: "", status: "ACTIVE" },
                {
                    no: "RK26092701",
                    bomCode: "ZMKW0001",
                    qty: 120,
                    date: "2026-09-27",
                    remark: "补录",
                    status: "ACTIVE",
                },
            ),
        ).toEqual([
            { key: "qty", label: "入库数量", before: "100 个", after: "120 个" },
            { key: "remark", label: "备注", before: null, after: "补录" },
        ]);
    });
});

describe("changesOfAdjustment / reasonText", () => {
    it("调整数量带符号，关联入库单可选", () => {
        expect(changesOfAdjustment(20, null)).toEqual([
            { key: "qtyDelta", label: "调整数量", before: null, after: "+20 个" },
        ]);
        expect(changesOfAdjustment(-5, "RK26092701")).toEqual([
            { key: "qtyDelta", label: "调整数量", before: null, after: "-5 个" },
            { key: "relatedInboundNo", label: "关联入库单", before: null, after: "RK26092701" },
        ]);
    });

    it("reason 空串与 null 归一为 null", () => {
        expect(reasonText("客户撤单")).toBe("客户撤单");
        expect(reasonText("")).toBeNull();
        expect(reasonText(null)).toBeNull();
    });
});
