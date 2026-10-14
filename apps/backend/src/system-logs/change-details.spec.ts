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

    it("delete_order：同 create 口径透出 BOM 快照；spec 缺失的存量行已由迁移回填，读侧不再拼装", () => {
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
                // 迁移 20260947000000 已把存量缺 spec 的行回填，读时按 items 兜底
                // 拼装的分支已退役：异常缺失按空值不展示口径降级
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
            }),
        ).toEqual([
            { key: "customer", label: "客户", before: null, after: "锦泰科技" },
            { key: "bomCode", label: "BOM 编码", before: null, after: "ZMKW0002" },
            { key: "bomName", label: "成品名称", before: null, after: "新微动" },
            { key: "qty", label: "订单数量", before: null, after: "100 个" },
            { key: "deliverDate", label: "交货日期", before: null, after: "2026-10-20" },
        ]);
    });

    it("archive_order：客户随行，状态由进行中推断为已归档", () => {
        expect(
            changesOfOpLog("archive_order", { customer: "华辰电器", qty: 300, lifecycleStatus: "ARCHIVED" }),
        ).toEqual([
            { key: "customer", label: "客户", before: null, after: "华辰电器" },
            { key: "lifecycleStatus", label: "订单状态", before: "进行中", after: "已归档" },
            { key: "qty", label: "订单数量", before: null, after: "300 个" },
        ]);
    });

    it("unarchive_order：客户随行，状态由已归档推断为进行中", () => {
        expect(
            changesOfOpLog("unarchive_order", { customer: "华辰电器", qty: 300, lifecycleStatus: "ACTIVE" }),
        ).toEqual([
            { key: "customer", label: "客户", before: null, after: "华辰电器" },
            { key: "lifecycleStatus", label: "订单状态", before: "已归档", after: "进行中" },
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

    it("update_customer 的 ownerChanged：客户名随行，移交只展示负责销售 from → to", () => {
        expect(
            changesOfOpLog("update_customer", {
                name: "锦泰科技",
                ownerChanged: { from: "周宁", to: "王明" },
                batchId: "9000000000000000",
                reason: "原负责人离岗，统一移交客户",
            }),
        ).toEqual([
            { key: "name", label: "客户名称", before: null, after: "锦泰科技" },
            { key: "owner", label: "负责销售", before: "周宁", after: "王明" },
        ]);
    });

    it("create_customer：名称与负责销售", () => {
        expect(changesOfOpLog("create_customer", { name: "嘉信电子", ownerAccount: "sales01" })).toEqual([
            { key: "name", label: "客户名称", before: null, after: "嘉信电子" },
            { key: "ownerAccount", label: "负责销售", before: null, after: "sales01" },
        ]);
    });

    it("delete_customer：删除前快照透出档案关键事实，地区四段合并、可空字段缺省跳过", () => {
        expect(
            changesOfOpLog("delete_customer", {
                name: "嘉信电子",
                contact: "李强",
                province: "广东省",
                city: "深圳市",
                district: "南山区",
                town: null,
                address: "科技园 1 号",
                payTerms: "月结 30 天",
                owner: "销售甲",
                ownerAccount: "sales01",
                createdBy: "郭均",
                created: "2026-09-01T00:00:00.000Z",
            }),
        ).toEqual([
            { key: "name", label: "客户名称", before: null, after: "嘉信电子" },
            { key: "contact", label: "联系人", before: null, after: "李强" },
            { key: "region", label: "所在地区", before: null, after: "广东省 / 深圳市 / 南山区" },
            { key: "address", label: "详细地址", before: null, after: "科技园 1 号" },
            { key: "payTerms", label: "付款条件", before: null, after: "月结 30 天" },
            { key: "owner", label: "负责销售", before: null, after: "销售甲" },
            { key: "created", label: "建档时间", before: null, after: "2026-09-01T00:00:00.000Z" },
        ]);
    });

    it("void_inbound：BOM 编码/数量随行（未变字段也要展示），状态 diff 映射有效/已作废", () => {
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
        ).toEqual([
            { key: "bomCode", label: "BOM 编码", before: null, after: "ZMKW0001" },
            { key: "qty", label: "入库数量", before: null, after: "100 个" },
            { key: "status", label: "状态", before: "有效", after: "已作废" },
        ]);
    });

    it("ship：客户随行，发货数量/订单号与备注", () => {
        expect(
            changesOfOpLog("ship", { orderNo: "ZM260927001", qty: 40, remark: "加急", customer: "华辰电器" }),
        ).toEqual([
            { key: "customer", label: "客户", before: null, after: "华辰电器" },
            { key: "qty", label: "发货数量", before: null, after: "40 个" },
            { key: "orderNo", label: "订单号", before: null, after: "ZM260927001" },
            { key: "remark", label: "备注", before: null, after: "加急" },
        ]);
    });

    it("void_outbound：客户随行（shipmentSnapshot），出库数量与订单号", () => {
        expect(
            changesOfOpLog("void_outbound", {
                customer: "锦泰科技",
                customerCode: "CUS-0031",
                orderNo: "ZM260927002",
                qty: 50,
            }),
        ).toEqual([
            { key: "customer", label: "客户", before: null, after: "锦泰科技" },
            { key: "qty", label: "出库数量", before: null, after: "50 个" },
            { key: "orderNo", label: "订单号", before: null, after: "ZM260927002" },
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

    it("订单编辑换客户/BOM：客户与 BOM 编码/成品名称/型号入 diff（同品类换 BOM 靠编码可见）；存量行缺键不渲染", () => {
        expect(
            changesOfOrderEdit(
                {
                    orderNo: "ZM260927001",
                    qty: 500,
                    orderDate: "2026-09-27",
                    deliverDate: "2026-10-08",
                    remark: "",
                    lifecycleStatus: "ACTIVE",
                    customer: "华辰电器",
                    customerCode: "CUS-0012",
                    bomCode: "ZMKW0001",
                    bomName: "新微动",
                    bomModel: "",
                    rowVersion: 1,
                },
                {
                    orderNo: "ZM260927001",
                    qty: 500,
                    orderDate: "2026-09-27",
                    deliverDate: "2026-10-08",
                    remark: "",
                    lifecycleStatus: "ACTIVE",
                    customer: "锦泰科技",
                    customerCode: "CUS-0031",
                    bomCode: "ZMKW0002",
                    bomName: "防水微动",
                    bomModel: "FS-1A",
                    rowVersion: 2,
                },
            ),
        ).toEqual([
            { key: "customer", label: "客户", before: "华辰电器", after: "锦泰科技" },
            { key: "bomCode", label: "BOM 编码", before: "ZMKW0001", after: "ZMKW0002" },
            { key: "bomName", label: "成品名称", before: "新微动", after: "防水微动" },
        ]);
        // 同品类同名换 BOM：名称/型号不变，编码行是唯一可见变更
        expect(
            changesOfOrderEdit(
                { qty: 5, remark: "", lifecycleStatus: "ACTIVE", bomCode: "ZMKW0001", bomName: "新微动", bomModel: "" },
                { qty: 5, remark: "", lifecycleStatus: "ACTIVE", bomCode: "ZMKW0009", bomName: "新微动", bomModel: "" },
            ),
        ).toEqual([{ key: "bomCode", label: "BOM 编码", before: "ZMKW0001", after: "ZMKW0009" }]);
        // 存量历史行 before/after 均无客户键：判 null 相等不渲染，不抛错
        expect(
            changesOfOrderEdit(
                { qty: 5, remark: "", lifecycleStatus: "ACTIVE" },
                { qty: 6, remark: "", lifecycleStatus: "ACTIVE" },
            ),
        ).toEqual([{ key: "qty", label: "订单数量", before: "5 个", after: "6 个" }]);
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
    it("成品名称随行，调整数量带符号，关联入库单可选", () => {
        expect(changesOfAdjustment(20, null, "新微动")).toEqual([
            { key: "bomName", label: "成品名称", before: null, after: "新微动" },
            { key: "qtyDelta", label: "调整数量", before: null, after: "+20 个" },
        ]);
        expect(changesOfAdjustment(-5, "RK26092701", null)).toEqual([
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

describe("BOM 结构维护动作卡片", () => {
    it("create_bom_category：品类名/编码前缀/目录结构关键事实", () => {
        expect(
            changesOfOpLog("create_bom_category", {
                name: "新品类1",
                categoryKey: "np1",
                codePrefix: "NP1",
                seqWidth: 3,
                sections: 1,
                groups: 2,
                items: 5,
            }),
        ).toEqual([
            { key: "name", label: "品类名称", before: null, after: "新品类1" },
            { key: "codePrefix", label: "编码前缀", before: null, after: "NP1" },
            { key: "structure", label: "目录结构", before: null, after: "1 分区 · 2 分组 · 5 物料" },
        ]);
    });

    it("update_bom_structure：版本跃迁 + 变动节点前后值 + 隐藏引用提示；空操作为 null", () => {
        expect(
            changesOfOpLog("update_bom_structure", {
                name: "旋转XK2",
                rowVersionBefore: 3,
                rowVersionAfter: 4,
                operations: [
                    { nodeType: "group", nodeId: "9001", name: "弹静片", added: true, after: { position: 3 } },
                    {
                        nodeType: "item",
                        nodeId: "3051",
                        name: "0-2",
                        before: { status: true },
                        after: { status: false },
                    },
                    {
                        nodeType: "group",
                        nodeId: "2008",
                        name: "A面",
                        before: { multi: true, qty: false },
                        after: { multi: false, qty: false },
                    },
                    { nodeType: "item", nodeId: "3001", name: "0-1", before: { position: 2 }, after: { position: 1 } },
                ],
                hiddenUsage: 3,
            }),
        ).toEqual([
            { key: "category", label: "品类", before: null, after: "旋转XK2" },
            { key: "version", label: "目录版本", before: "3", after: "4" },
            { key: "op-0", label: "变动 1", before: null, after: "分组「弹静片」新增" },
            { key: "op-1", label: "变动 2", before: null, after: "物料「0-2」隐藏" },
            { key: "op-2", label: "变动 3", before: null, after: "分组「A面」多选 → 单选" },
            { key: "op-3", label: "变动 4", before: null, after: "物料「0-1」第 2 位 → 第 1 位" },
            {
                key: "hiddenUsage",
                label: "隐藏物料引用",
                before: null,
                after: "仍被 3 行既有 BOM 明细引用（不影响旧档案）",
            },
        ]);
        expect(changesOfOpLog("update_bom_structure", null)).toBeNull();
        expect(
            changesOfOpLog("update_bom_structure", {
                name: "旋转XK2",
                rowVersionBefore: 1,
                rowVersionAfter: 2,
                operations: [],
            }),
        ).toBeNull();
    });
});
