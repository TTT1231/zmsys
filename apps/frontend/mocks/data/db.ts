/* Mock 内存数据库（原 src/data/store.ts 迁移）
 * - 日期锚点动态取「今天」，种子数据按相对天数生成，演示数据始终新鲜
 * - mulberry32 固定种子：同一天内刷新结果一致
 * - 不变量：每 BOM Σ入库 − Σ出库 = 当前可用库存
 * - 仅授权（grants）落 localStorage 模拟后端持久化；Node 环境下自动跳过
 * - 无浏览器顶层 API，可被 node --test 直接导入 */
import type { Bom, Customer, InboundRow, OpLogEntry, Order, OutboundRow, Snapshot, WbUser } from "@/api";
// 注意：本文件被 node --test 直跑（scripts/inventory.test.mjs），Node 不解析 "@/ 别名，
// 因此运行时值导入保留相对路径 + .ts 扩展名；type 导入会被擦除，可用别名
import type { GrantMap, RoleGrant, RoleId } from "@/data/permissions";
import { ROLES, buildDefaultGrants } from "../../src/data/permissions.ts";
import type { GrantLogEntry } from "@/api";
import {
    categoryOf,
    defaultsOf,
    NEW_MICRO_SWITCH_BRACKET_OPTIONS,
    NEW_MICRO_SWITCH_STATIC_PLATE_OPTIONS,
    newMicroSwitchGaugeOf,
    nextBomCode,
} from "../../src/data/categories.ts";
import { addDays, nowStamp, nowTime, todayIso } from "../../src/lib/date.ts";
import { maxShipOf } from "../../src/data/views.ts";

export const ANCHOR = todayIso();

const clampDate = (isoDate: string, min: string, max: string) => (isoDate < min ? min : isoDate > max ? max : isoDate);

// 确定性 PRNG（mulberry32）
function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rng = mulberry32(20260905);
const randInt = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

/** 操作人（来自当前 token），写台账/日志时落名 */
export interface Actor {
    name: string;
    roleLabel: string;
}

const CUSTOMER_SEEDS: Array<[string, string]> = [
    ["华兴精密制造", "CUS-1024"],
    ["东莞启程电子", "CUS-0316"],
    ["苏州新锐汽车", "CUS-0788"],
    ["杭州微控科技", "CUS-0542"],
    ["宁波博远工业", "CUS-0210"],
    ["上海恒拓设备", "CUS-1190"],
    ["深圳联科电器", "CUS-0641"],
    ["广州锐进汽车", "CUS-0832"],
    ["成都锐成装备", "CUS-0906"],
    ["天津远达机电", "CUS-0427"],
];

const CONTACT_SEEDS: Array<[string, string, string, string, string, string]> = [
    // 联系人 / 电话 / 省 / 市 / 县区 / 乡镇街道
    ["王建国", "138****6821", "江苏省", "苏州市", "吴中区", "长桥街道"],
    ["李雪梅", "139****3417", "广东省", "东莞市", "", "南城街道"],
    ["张伟", "137****9055", "江苏省", "苏州市", "相城区", "元和街道"],
    ["陈静", "136****2764", "浙江省", "杭州市", "西湖区", "文新街道"],
    ["刘强", "135****8391", "浙江省", "宁波市", "鄞州区", "首南街道"],
    ["赵敏", "158****6142", "上海市", "市辖区", "浦东新区", "张江镇"],
    ["孙丽", "186****4529", "广东省", "深圳市", "南山区", "粤海街道"],
    ["周涛", "150****7385", "广东省", "广州市", "天河区", "天园街道"],
    ["吴昊", "133****2968", "四川省", "成都市", "武侯区", "簇桥街道"],
    ["郑爽", "155****5073", "天津市", "市辖区", "津南区", "双港镇"],
];

const buildCustomers = (): Customer[] =>
    CUSTOMER_SEEDS.map(([name, code], index) => {
        const [contact, phone, province, city, district, town] = CONTACT_SEEDS[index];
        return {
            code,
            name,
            contact,
            phone,
            province,
            city,
            district,
            town,
            address: ["兴园路 88 号", "兴业路 21 号", "科技园 3 栋", "创新大厦 12F"][index % 4],
            cooperation: "待跟进", // 占位；真实值由 listCustomers 按订单聚合派生
            owner: "陈洁",
            payTerms: "月结 30 天",
            created: addDays(ANCHOR, -(120 + index * 37)),
        };
    });

// 33 条人工审核旋转开关主数据（编码 ZMXK2001 起，specs 键值对见品类模板）
const ROTARY_ROWS: Array<{
    modelCode: string;
    foot: string;
    gear: string;
    gearSpec: string;
    gearDir: string;
    thickness: string;
    spring: string;
}> = [
    {
        modelCode: "1-1",
        foot: "二脚",
        gear: "一档",
        gearSpec: "211-1",
        gearDir: "正面",
        thickness: "0.2",
        spring: "0.5",
    },
    {
        modelCode: "2-1",
        foot: "三脚",
        gear: "两档",
        gearSpec: "222-1",
        gearDir: "正面",
        thickness: "0.2",
        spring: "0.5",
    },
    {
        modelCode: "2-1",
        foot: "四脚",
        gear: "两档",
        gearSpec: "2-1-4",
        gearDir: "正面",
        thickness: "0.2",
        spring: "0.5",
    },
    {
        modelCode: "2-2",
        foot: "三脚",
        gear: "两档",
        gearSpec: "222-2",
        gearDir: "正面",
        thickness: "0.2",
        spring: "0.5",
    },
    {
        modelCode: "3-1",
        foot: "五脚",
        gear: "三档",
        gearSpec: "233-4",
        gearDir: "正面",
        thickness: "0.2",
        spring: "0.5",
    },
    {
        modelCode: "3-2",
        foot: "三脚",
        gear: "三档",
        gearSpec: "233-1-B",
        gearDir: "反面",
        thickness: "0.2",
        spring: "0.5",
    },
    {
        modelCode: "3-2",
        foot: "五脚",
        gear: "三档",
        gearSpec: "233-1",
        gearDir: "反面",
        thickness: "0.2",
        spring: "0.5",
    },
    { modelCode: "4-1", foot: "六脚", gear: "四档", gearSpec: "", gearDir: "正面", thickness: "0.2", spring: "0.5" },
    {
        modelCode: "4-2",
        foot: "五脚",
        gear: "四档",
        gearSpec: "243-1-2",
        gearDir: "正面",
        thickness: "0.2",
        spring: "0.5",
    },
    {
        modelCode: "4-3",
        foot: "三脚",
        gear: "四档",
        gearSpec: "243-5B",
        gearDir: "正面反轴",
        thickness: "0.2",
        spring: "0.5",
    },
    {
        modelCode: "4-3",
        foot: "五脚",
        gear: "四档",
        gearSpec: "243-5A",
        gearDir: "正面反轴",
        thickness: "0.2",
        spring: "0.5",
    },
    {
        modelCode: "4-3",
        foot: "五脚",
        gear: "四档",
        gearSpec: "243-5",
        gearDir: "反面转90°扇位朝上",
        thickness: "0.2",
        spring: "0.5",
    },
    {
        modelCode: "4-4",
        foot: "五脚",
        gear: "四档",
        gearSpec: "243-1",
        gearDir: "反面",
        thickness: "0.2",
        spring: "0.5",
    },
    { modelCode: "4-8", foot: "五脚", gear: "四档", gearSpec: "", gearDir: "正面", thickness: "0.2", spring: "0.5" },
    { modelCode: "4-9", foot: "五脚", gear: "四档", gearSpec: "", gearDir: "正面", thickness: "0.2", spring: "0.5" },
    {
        modelCode: "0-2",
        foot: "六脚",
        gear: "八档",
        gearSpec: "全方位/冷风扇/284-1B",
        gearDir: "正面",
        thickness: "0.2",
        spring: "0.55",
    },
    {
        modelCode: "0-2",
        foot: "六脚",
        gear: "八档",
        gearSpec: "全方位/冷风扇/284-1B",
        gearDir: "正面转90°扇位朝上",
        thickness: "0.3",
        spring: "0.55",
    },
    {
        modelCode: "0-2",
        foot: "五脚",
        gear: "八档",
        gearSpec: "全方位/284-2B",
        gearDir: "正面",
        thickness: "0.2",
        spring: "0.55",
    },
    {
        modelCode: "0-3",
        foot: "三脚",
        gear: "两档",
        gearSpec: "212-1",
        gearDir: "正面",
        thickness: "0.2",
        spring: "0.55",
    },
    {
        modelCode: "0-3",
        foot: "五脚",
        gear: "四档",
        gearSpec: "263-1-A",
        gearDir: "正面",
        thickness: "0.2",
        spring: "0.55",
    },
    {
        modelCode: "0-3",
        foot: "五脚",
        gear: "四档",
        gearSpec: "263-1-A",
        gearDir: "正面反轴",
        thickness: "0.2",
        spring: "0.55",
    },
    {
        modelCode: "0-4",
        foot: "六脚",
        gear: "八档",
        gearSpec: "284-1A",
        gearDir: "正面",
        thickness: "0.2",
        spring: "0.5",
    },
    {
        modelCode: "0-4-1",
        foot: "六脚",
        gear: "八档",
        gearSpec: "284-2",
        gearDir: "正面",
        thickness: "0.2",
        spring: "0.55",
    },
    {
        modelCode: "0-4",
        foot: "五脚",
        gear: "八档",
        gearSpec: "284-1",
        gearDir: "正面",
        thickness: "0.2",
        spring: "0.5",
    },
    {
        modelCode: "0-5",
        foot: "六脚",
        gear: "八档",
        gearSpec: "284-3",
        gearDir: "正面",
        thickness: "0.2",
        spring: "0.55",
    },
    { modelCode: "0-5", foot: "六脚", gear: "八档", gearSpec: "", gearDir: "正面", thickness: "0.3", spring: "0.55" },
    {
        modelCode: "0-5",
        foot: "五脚",
        gear: "八档",
        gearSpec: "284-4",
        gearDir: "正面",
        thickness: "0.2",
        spring: "0.55",
    },
    { modelCode: "0-6", foot: "六脚", gear: "五档", gearSpec: "", gearDir: "正面", thickness: "0.2", spring: "0.6" },
    { modelCode: "0-7", foot: "五脚", gear: "四档", gearSpec: "", gearDir: "正面", thickness: "0.2", spring: "0.6" },
    { modelCode: "0-8", foot: "三脚", gear: "四档", gearSpec: "", gearDir: "反面", thickness: "0.2", spring: "0.55" },
    { modelCode: "0-9", foot: "五脚", gear: "", gearSpec: "", gearDir: "", thickness: "0.2", spring: "0.55" },
    {
        modelCode: "0-9-1",
        foot: "五脚",
        gear: "六档",
        gearSpec: "全方位",
        gearDir: "反面",
        thickness: "0.2",
        spring: "0.55",
    },
    { modelCode: "3-1", foot: "五脚", gear: "三档", gearSpec: "", gearDir: "", thickness: "0.2", spring: "0.5" },
];

// XK3 / 新微动 / 老微动 / 琴键开关种子数据（按真实物料清单建档，品类常量由 defaultsOf 并入）

/* 规格维度笛卡尔积：[[键, 选项], ...] → 逐维展开的键值对数组 */
const specCombos = (dims: Array<[string, string[]]>): Record<string, string>[] =>
    dims.reduce<Record<string, string>[]>(
        (rows, [key, options]) => rows.flatMap(row => options.map(option => ({ ...row, [key]: option }))),
        [{}],
    );

// XK3 全组合：外壳5 × 底座2 × 杆子4 × 小静片2 × 半圆静片2 × 动片2 × 卡线片2 × 弹簧2 = 1280 种
const XK3_BOMS: Array<Pick<Bom, "code" | "name" | "modelCode" | "specs">> = specCombos([
    [
        "外壳",
        [
            "圆孔长外壳（茶色）",
            "圆孔长外壳（透明）",
            "圆孔短外壳（茶色）",
            "椭圆孔长外壳无CB字（茶色）",
            "无耳外壳无CB字（茶色）",
        ],
    ],
    ["底座", ["茶色", "透明"]],
    ["杆子", ["圆轴长杆子", "圆轴短杆子", "扁轴4.8", "扁轴4.8转90°"]],
    ["小静片", ["不电镀", "镀锡"]],
    ["半圆静片", ["不电镀", "镀锡"]],
    ["动片", ["不电镀", "镀锡"]],
    ["卡线片", ["0.15", "0.2"]],
    ["弹簧", ["0.45长弹簧", "0.45短弹簧"]],
]).map((specs, index) => ({
    code: `ZMXK3${String(index + 1).padStart(3, "0")}`,
    name: "XK3",
    modelCode: "XK3",
    specs,
}));

// 老微动全组合：底座2 × 按钮3 × 弹簧2 = 12 种
const OLD_KW_BOMS: Array<Pick<Bom, "code" | "name" | "modelCode" | "specs">> = specCombos([
    ["底座", ["带CB", "不带CB"]],
    ["按钮", ["8.5mm（常用装跌倒）", "8.9mm", "9.6mm"]],
    ["弹簧", ["0.25", "0.27"]],
]).map((specs, index) => ({
    code: `ZMKW16${String(index + 1).padStart(3, "0")}`,
    name: "老微动",
    modelCode: "KW16",
    specs,
}));

// 新微动全组合：底座2 × 按钮8 × (6.3支架3×6.3静片3 + 4.8支架2×4.8静片2) × 动片2 × 摆片3 × 弹片3 = 3744 种
const NEW_KW_BOMS: Array<Pick<Bom, "code" | "name" | "modelCode" | "specs">> = specCombos([
    ["底座", ["二脚底座（无挡脚）", "三脚底座（有挡脚）"]],
    ["按钮高度", ["7.6mm（常用装跌倒）", "8.0mm", "8.1mm", "8.2mm圆弧", "8.3mm", "8.5mm", "8.8mm", "9.1mm"]],
    ["支架", NEW_MICRO_SWITCH_BRACKET_OPTIONS],
    ["静片", NEW_MICRO_SWITCH_STATIC_PLATE_OPTIONS],
    ["动片", ["铜镀银", "镀锡"]],
    ["摆片", ["铜镀银摆片", "铁镀镍摆片", "复合铜镀镍摆片"]],
    ["弹片", ["0.12", "0.15", "0.2"]],
])
    .filter(specs => {
        const bracketGauge = newMicroSwitchGaugeOf(specs["支架"]);
        const staticPlateGauge = newMicroSwitchGaugeOf(specs["静片"]);
        return bracketGauge !== undefined && bracketGauge === staticPlateGauge;
    })
    .map((specs, index) => ({
        code: `ZMKW${String(index + 1).padStart(4, "0")}`,
        name: "新微动",
        modelCode: "KW",
        specs,
    }));

const EXTRA_BOMS: Array<Pick<Bom, "code" | "name" | "modelCode" | "specs">> = [
    ...XK3_BOMS,
    ...NEW_KW_BOMS,
    ...OLD_KW_BOMS,
    {
        code: "ZMKQ001",
        name: "琴键开关",
        modelCode: "KQ-1",
        specs: {
            类型: "四键焊线",
            卡板: "大卡板18mm+小卡板18mm+短卡板16mm",
            弹簧: "0.3",
            触点: "不带点",
            五金件明细: "扣板+连锁片×2+不带点静片+不带点动片",
        },
    },
    {
        code: "ZMKQ002",
        name: "琴键开关",
        modelCode: "KQ-2",
        specs: {
            类型: "四键插线",
            卡板: "大卡板18mm+小卡板18mm+短卡板16mm",
            弹簧: "0.3",
            触点: "不带点",
            五金件明细: "扣板+连锁片×2+不带点静片+不带点动片",
        },
    },
    {
        code: "ZMKQ003",
        name: "琴键开关",
        modelCode: "KQ-3",
        specs: {
            类型: "小太阳四键三档（摇头）",
            卡板: "小卡板18mm+短卡板16mm",
            弹簧: "0.35",
            触点: "带点",
            五金件明细: "扣板×2+连锁片+带点静片+带点动片",
        },
    },
    {
        code: "ZMKQ004",
        name: "琴键开关",
        modelCode: "KQ-4",
        specs: {
            类型: "小太阳四键二档（不摇头）",
            卡板: "小卡板18mm+短卡板16mm",
            弹簧: "0.35",
            触点: "带点",
            五金件明细: "扣板+连锁片+带点静片+带点动片",
        },
    },
    {
        code: "ZMKQ005",
        name: "琴键开关",
        modelCode: "KQ-5",
        specs: {
            类型: "冷风扇琴键（茶色）",
            卡板: "小卡板18mm+大卡板18mm",
            弹簧: "0.35",
            触点: "不带点",
            五金件明细: "扣板×2+连锁片+不带点静片+不带点动片+辅助动片",
        },
    },
    {
        code: "ZMKQ006",
        name: "琴键开关",
        modelCode: "KQ-6",
        specs: {
            类型: "冷风扇琴键（透明大功率带触点）",
            卡板: "小卡板18mm+大卡板18mm",
            弹簧: "0.35",
            触点: "带点",
            五金件明细: "扣板×2+连锁片+带点静片+带点动片+辅助动片",
        },
    },
];

const specOf = (bom: Pick<Bom, "name" | "modelCode" | "specs">) => {
    const def = categoryOf(bom.name);
    const parts = Object.entries(bom.specs)
        .filter(([key, value]) => {
            if (!value || !value.trim()) return false;
            const field = def?.fields.find(item => item.key === key);
            // 品类常量（defaultValue）各条目一致、无区分度，不进摘要
            return !(field?.defaultValue && field.defaultValue === value);
        })
        .map(([key, value]) => `${key} ${value}`);
    return [bom.modelCode, ...parts].filter(Boolean).join(" · ");
};

const buildBoms = (): Bom[] => {
    const rotary = categoryOf("旋转开关")!;
    const rotaryBoms: Bom[] = ROTARY_ROWS.map((row, index) => {
        const bom: Bom = {
            code: `ZMXK2${String(index + 1).padStart(3, "0")}`,
            name: "旋转开关",
            modelCode: row.modelCode,
            specs: {
                脚位: row.foot,
                档位: row.gear,
                规格: row.gearSpec,
                方向: row.gearDir,
                银点厚度: row.thickness,
                弹簧: row.spring,
                ...defaultsOf(rotary),
            },
            spec: "",
            created: addDays(ANCHOR, -3),
            unit: "个",
        };
        return { ...bom, spec: specOf(bom) };
    });
    const extraBoms: Bom[] = EXTRA_BOMS.map(row => {
        const bom: Bom = {
            ...row,
            // 品类常量（固定部件）并入 specs，行数据优先
            specs: { ...defaultsOf(categoryOf(row.name)!), ...row.specs },
            spec: "",
            created: addDays(ANCHOR, -3),
            unit: "个",
        };
        return { ...bom, spec: specOf(bom) };
    });
    return [...rotaryBoms, ...extraBoms];
};

const INSPECTORS = ["王师傅", "赵师傅", "周丽"];
const OPERATORS = ["王师傅", "周丽", "赵师傅"];

type SeededOrder = Order & { seedStock: number };

/** 静态订单：日期相对锚点生成，单号 ZM+yyMMdd+序号 */
function staticOrders(): SeededOrder[] {
    const mk = (
        seq: number,
        orderDaysAgo: number,
        deliverInDays: number,
        customerIndex: number,
        bomCode: string,
        qty: number,
        outbound: number,
        seedStock: number,
    ): SeededOrder => {
        const orderDate = addDays(ANCHOR, -orderDaysAgo);
        return {
            orderNo: `ZM${orderDate.slice(2).replaceAll("-", "")}${String(seq).padStart(3, "0")}`,
            customer: CUSTOMER_SEEDS[customerIndex][0],
            customerCode: CUSTOMER_SEEDS[customerIndex][1],
            bomCode,
            qty,
            outbound,
            orderDate,
            deliverStart: addDays(orderDate, Math.max(1, deliverInDays - 5)),
            deliverEnd: addDays(orderDate, deliverInDays),
            remark: "",
            seedStock,
        };
    };
    return [
        mk(86, 4, 15, 0, "ZMXK2001", 2400, 0, 1600),
        mk(85, 4, 19, 1, "ZMXK2002", 800, 0, 0),
        mk(84, 5, 13, 2, "ZMXK2003", 1200, 1200, 0),
        mk(83, 6, 11, 3, "ZMKW0001", 560, 560, 0),
        mk(82, 7, 20, 4, "ZMXK2005", 3000, 0, 1200),
        mk(81, 8, 17, 5, "ZMKW16001", 960, 0, 0),
        // 两笔 7 个月前的已完成历史订单：让成都锐成 / 天津远达在合作状态派生中落为「待跟进」
        mk(2, 215, 232, 8, "ZMKW0003", 400, 400, 0),
        mk(1, 226, 243, 9, "ZMXK2010", 500, 500, 0),
    ];
}

function buildOrders(boms: Bom[]): SeededOrder[] {
    const plan = [
        ...Array<string>(63).fill("已完成"),
        ...Array<string>(11).fill("可发货"),
        ...Array<string>(6).fill("待生产"),
    ];
    const seeded: SeededOrder[] = plan.map((status, index) => {
        const seq = 80 - index;
        // 近期订单只落在前 8 家客户：成都锐成 / 天津远达仅有 7 个月前的历史单，合作状态派生为「待跟进」
        const [customer, customerCode] = CUSTOMER_SEEDS[(seq * 7) % 8];
        const bom = boms[(seq * 3) % boms.length];
        const qty = 300 + ((seq * 137) % 4200);
        const done = status === "已完成" ? qty : status === "可发货" ? Math.floor(qty * (0.2 + (seq % 5) * 0.15)) : 0;
        const orderDate = addDays(ANCHOR, -9 - Math.floor(index / 2));
        return {
            orderNo: `ZM${orderDate.slice(2).replaceAll("-", "")}${String(seq).padStart(3, "0")}`,
            customer,
            customerCode,
            bomCode: bom.code,
            qty,
            outbound: status === "已完成" ? qty : 0,
            orderDate,
            deliverStart: addDays(orderDate, 7 + (seq % 4)),
            deliverEnd: addDays(orderDate, 12 + (seq % 8)),
            remark: "",
            seedStock: status === "可发货" ? done : 0,
        };
    });
    return [...staticOrders().map(order => ({ ...order })), ...seeded];
}

/* ---- 内存库（handler 侧单例） ---- */
const MOCK_PASSWORD = "123456";
const GRANT_LS_KEY = "zm-permissions";
const GRANT_LS_VERSION = 2;

type DbUser = WbUser & { password: string };

class MockDb {
    orders: Order[] = [];
    boms: Bom[] = [];
    customers: Customer[] = [];
    inboundLedger: InboundRow[] = [];
    outboundLedger: OutboundRow[] = [];
    stock = new Map<string, number>();
    users: DbUser[] = [
        {
            id: 1,
            name: "系统管理员",
            account: "sys_admin",
            role: "super",
            active: true,
            last: `${addDays(ANCHOR, 0).slice(5)} 08:12`,
            password: MOCK_PASSWORD,
        },
        {
            id: 2,
            name: "李晓梅",
            account: "li_xiaomei",
            role: "admin",
            active: true,
            last: `${addDays(ANCHOR, 0).slice(5)} 09:40`,
            password: MOCK_PASSWORD,
        },
        {
            id: 3,
            name: "陈志强",
            account: "chen_zhiqiang",
            role: "admin",
            active: true,
            last: `${addDays(ANCHOR, -1).slice(5)} 17:22`,
            password: MOCK_PASSWORD,
        },
        {
            id: 4,
            name: "周丽",
            account: "zhou_li",
            role: "warehouse",
            active: true,
            last: `${addDays(ANCHOR, 0).slice(5)} 08:55`,
            password: MOCK_PASSWORD,
        },
        {
            id: 5,
            name: "王师傅",
            account: "wang_shifu",
            role: "warehouse",
            active: true,
            last: `${addDays(ANCHOR, -2).slice(5)} 16:03`,
            password: MOCK_PASSWORD,
        },
        {
            id: 6,
            name: "赵师傅",
            account: "zhao_shifu",
            role: "warehouse",
            active: true,
            last: `${addDays(ANCHOR, -3).slice(5)} 11:20`,
            password: MOCK_PASSWORD,
        },
        {
            id: 7,
            name: "陈洁",
            account: "chen_jie",
            role: "sales",
            active: true,
            last: `${addDays(ANCHOR, 0).slice(5)} 09:12`,
            password: MOCK_PASSWORD,
        },
        {
            id: 8,
            name: "刘敏",
            account: "liu_min",
            role: "staff",
            active: true,
            last: `${addDays(ANCHOR, -4).slice(5)} 15:44`,
            password: MOCK_PASSWORD,
        },
    ];
    opLog: OpLogEntry[] = [];
    version = 1;
    grants: GrantMap = loadGrants();
    grantLog: GrantLogEntry[] = [
        {
            time: `${addDays(ANCHOR, -2).slice(5)} 09:30`,
            user: "系统管理员",
            text: "角色【仓管】授权变更：新增 成品出库：登记发货、更正记录，保留 打印出库单 未授权",
        },
        {
            time: `${addDays(ANCHOR, -3).slice(5)} 16:20`,
            user: "系统管理员",
            text: "角色【员工】授权确认：仅保留查看类权限，移除全部写操作",
        },
    ];

    init() {
        this.boms = buildBoms();
        const orders = buildOrders(this.boms);
        this.customers = buildCustomers();

        // 共享库存：Σ 可发货订单种子库存（同 BOM 库存跨订单共享）
        orders.forEach(order => {
            if (order.seedStock > 0)
                this.stock.set(order.bomCode, (this.stock.get(order.bomCode) || 0) + order.seedStock);
        });
        this.orders = orders.map(({ seedStock: _seedStock, ...order }) => order);

        this.outboundLedger = this.buildOutboundLedger();
        this.inboundLedger = this.buildInboundLedger();
        this.opLog = this.buildOpLog();
    }

    bomByCode(code: string) {
        return this.boms.find(bom => bom.code === code);
    }

    stockOf(bomCode: string) {
        return Math.max(0, this.stock.get(bomCode) || 0);
    }

    remainingOf(order: Order) {
        return Math.max(0, order.qty - order.outbound);
    }

    listUsers(): WbUser[] {
        return this.users.map(({ password: _password, ...user }) => ({ ...user }));
    }

    /** 合作状态（聚合派生，不落库）：近 6 个月（183 天）有订单 = 合作中，否则待跟进 */
    private cooperationOf(customerCode: string): "合作中" | "待跟进" {
        const windowStart = addDays(ANCHOR, -183);
        return this.orders.some(order => order.customerCode === customerCode && order.orderDate >= windowStart)
            ? "合作中"
            : "待跟进";
    }

    listCustomers(): Customer[] {
        return this.customers.map(customer => ({ ...customer, cooperation: this.cooperationOf(customer.code) }));
    }

    private timeOf(seedIndex: number) {
        return `${String(8 + (seedIndex % 9)).padStart(2, "0")}:${String((seedIndex * 17) % 60).padStart(2, "0")}`;
    }

    private buildOutboundLedger(): OutboundRow[] {
        const raw: Array<Omit<OutboundRow, "no">> = [];
        const shipped = this.orders.filter(order => order.outbound > 0);
        const recent = [...shipped]
            .sort((a, b) => a.deliverEnd.localeCompare(b.deliverEnd))
            .slice(-12)
            .map(order => order.orderNo);
        const recentSet = new Set([
            ...recent,
            ...staticOrders()
                .slice(2, 4)
                .map(order => order.orderNo),
        ]);
        const todayFirst = new Set(recent.slice(-6));

        shipped.forEach(order => {
            const parts = order.qty > 2000 ? 2 : 1;
            const firstQty = parts === 2 ? Math.round(order.qty * (0.45 + rng() * 0.15)) : order.qty;
            let cursor = 0;
            [firstQty, order.qty - firstQty].slice(0, parts).forEach((qty, partIndex) => {
                cursor += 1;
                let date: string;
                if (recentSet.has(order.orderNo)) {
                    date = partIndex === 0 && todayFirst.has(order.orderNo) ? ANCHOR : addDays(ANCHOR, -randInt(1, 6));
                } else {
                    date = clampDate(addDays(order.deliverEnd, -randInt(0, 3)), addDays(ANCHOR, -55), ANCHOR);
                }
                raw.push({
                    orderNo: order.orderNo,
                    customer: order.customer,
                    customerCode: order.customerCode,
                    bomCode: order.bomCode,
                    qty,
                    date,
                    time: this.timeOf(raw.length * 3 + partIndex),
                    operator: OPERATORS[raw.length % OPERATORS.length],
                });
            });
        });

        raw.sort((a, b) => (a.date === b.date ? a.orderNo.localeCompare(b.orderNo) : a.date.localeCompare(b.date)));
        const counter = new Map<string, number>();
        return raw.map(row => {
            const seq = (counter.get(row.date) || 0) + 1;
            counter.set(row.date, seq);
            return { ...row, no: `CK-${row.date.replaceAll("-", "")}-${String(seq).padStart(4, "0")}` };
        });
    }

    private buildInboundLedger(): InboundRow[] {
        const outByBom = new Map<string, number>();
        const firstOutByBom = new Map<string, OutboundRow>();
        this.outboundLedger.forEach(row => {
            outByBom.set(row.bomCode, (outByBom.get(row.bomCode) || 0) + row.qty);
            const prev = firstOutByBom.get(row.bomCode);
            if (!prev || row.date < prev.date) firstOutByBom.set(row.bomCode, row);
        });

        const weekStart = addDays(ANCHOR, -6);
        const recentBoms = new Set(this.outboundLedger.filter(row => row.date >= weekStart).map(row => row.bomCode));
        const anchorBoms = new Set(
            this.outboundLedger
                .filter(row => row.date === ANCHOR)
                .map(row => row.bomCode)
                .slice(0, 3),
        );

        const raw: Array<Omit<InboundRow, "no">> = [];
        this.boms.forEach(bom => {
            const totalIn = (outByBom.get(bom.code) || 0) + this.stockOf(bom.code);
            if (totalIn <= 0) return;
            const partCount = Math.min(5, Math.max(2, Math.ceil(totalIn / 1600)));
            const weights = Array.from({ length: partCount }, () => 0.7 + rng() * 0.6);
            const weightSum = weights.reduce((sum, value) => sum + value, 0);
            const firstOut = firstOutByBom.get(bom.code);
            const baseDate = firstOut ? firstOut.date : addDays(ANCHOR, -randInt(10, 20));
            let allocated = 0;
            for (let i = 0; i < partCount; i += 1) {
                const isLast = i === partCount - 1;
                const qty = isLast
                    ? totalIn - allocated
                    : Math.max(100, Math.round((totalIn * weights[i]) / weightSum));
                allocated += qty;
                let date: string;
                if (isLast && anchorBoms.has(bom.code)) date = ANCHOR;
                else if (isLast && recentBoms.has(bom.code)) date = addDays(ANCHOR, -randInt(0, 6));
                else
                    date = clampDate(
                        addDays(baseDate, -randInt(1, 4) - i * randInt(2, 8)),
                        addDays(ANCHOR, -60),
                        ANCHOR,
                    );
                raw.push({
                    bomCode: bom.code,
                    qty,
                    date,
                    time: this.timeOf(raw.length * 5 + i),
                    inspector: INSPECTORS[raw.length % INSPECTORS.length],
                });
            }
        });

        raw.sort((a, b) => (a.date === b.date ? a.bomCode.localeCompare(b.bomCode) : a.date.localeCompare(b.date)));
        const counter = new Map<string, number>();
        return raw.map(row => {
            const seq = (counter.get(row.date) || 0) + 1;
            counter.set(row.date, seq);
            return { ...row, no: `RK-${row.date.replaceAll("-", "")}-${String(seq).padStart(4, "0")}` };
        });
    }

    /* op_log 口径（db-scheme §2.4）：只记三种操作——登记发货 / 新建客户 / 新建销售订单 */
    private buildOpLog(): OpLogEntry[] {
        const entries: OpLogEntry[] = [];
        const push = (date: string, time: string, user: string, role: string, action: string, target: string) =>
            entries.push({ date, time, user, role, action, target });
        this.outboundLedger
            .filter(row => row.date === ANCHOR || row.date === addDays(ANCHOR, -1) || row.date === addDays(ANCHOR, -2))
            .forEach(row =>
                push(
                    row.date,
                    row.time,
                    row.operator,
                    row.operator === "周丽" ? "仓库管理员" : "检验员",
                    "登记发货",
                    row.no,
                ),
            );
        const newestOrder = staticOrders()[0]?.orderNo ?? "—";
        push(ANCHOR, "09:12", "陈洁", "销售", "新建销售订单", newestOrder);
        push(ANCHOR, "08:47", "陈洁", "销售", "新建客户档案", "CUS-0906");
        return entries.sort((a, b) =>
            a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date),
        );
    }

    // ---- 认证 ----

    verifyLogin(account: string, password: string): DbUser | null {
        const user = this.users.find(item => item.account === account.trim());
        if (!user || !user.active || user.password !== password) return null;
        user.last = nowStamp();
        return user;
    }

    issueToken(account: string): string {
        return `mock.${account}.${Date.now().toString(36)}`;
    }

    resolveToken(token: string): DbUser | null {
        const [, account] = token.split(".");
        if (!account) return null;
        const user = this.users.find(item => item.account === account);
        return user && user.active ? user : null;
    }

    /** 个人中心：仅允许更新自己的姓名（账号/角色/状态为管理员域） */
    updateUserName(account: string, name: string): WbUser {
        const user = this.users.find(item => item.account === account);
        if (!user || !user.active) throw new Error("账号不存在或已停用");
        user.name = name;
        const { password: _password, ...rest } = user;
        return rest;
    }

    /** 个人中心：修改自己的密码（旧密码校验 + 新密码 ≥6 位；不强制改密） */
    changePassword(account: string, oldPassword: string, newPassword: string): void {
        const user = this.users.find(item => item.account === account);
        if (!user || !user.active) throw new Error("账号不存在或已停用");
        if (user.password !== oldPassword) throw new Error("旧密码不正确");
        if (newPassword.length < 6) throw new Error("新密码至少 6 位");
        user.password = newPassword;
    }

    // ---- 授权 ----

    getGrant(role: RoleId): RoleGrant {
        return this.grants[role];
    }

    saveGrants(role: RoleId, grant: RoleGrant, note: string, actor: Actor) {
        this.grants = { ...this.grants, [role]: grant };
        persistGrants(this.grants);
        if (note.trim()) {
            this.grantLog.unshift({ time: `${todayIso().slice(5)} ${nowTime()}`, user: actor.name, text: note.trim() });
        }
    }

    // ---- 变更操作（校验与单号规则同旧版，日志落操作人） ----

    createOrder(
        input: {
            customerCode: string;
            customer: string;
            bomCode: string;
            qty: number;
            deliverStart: string;
            deliverEnd: string;
            orderDate: string;
            remark: string;
        },
        actor: Actor,
    ): Order {
        const customer = this.customers.find(item => item.code === input.customerCode);
        if (!customer) throw new Error("客户不存在");
        if (!this.bomByCode(input.bomCode)) throw new Error("成品不存在");
        if (input.deliverEnd < input.deliverStart) throw new Error("交货截止日期不能早于起始日期");
        const yyMMdd = input.orderDate.slice(2).replaceAll("-", "");
        // 按日递增取号：单号日期段来自 orderDate，序号取「同日已有订单」最大值 + 1
        const sameDay = this.orders.filter(order => order.orderNo.startsWith(`ZM${yyMMdd}`));
        const maxSeq = sameDay.reduce((max, order) => Math.max(max, Number(order.orderNo.slice(-3)) || 0), 0);
        const orderNo = `ZM${yyMMdd}${String(maxSeq + 1).padStart(3, "0")}`;
        const order: Order = {
            orderNo,
            customer: customer.name,
            customerCode: input.customerCode,
            bomCode: input.bomCode,
            qty: input.qty,
            outbound: 0,
            orderDate: input.orderDate,
            deliverStart: input.deliverStart,
            deliverEnd: input.deliverEnd,
            remark: input.remark,
        };
        this.orders.unshift(order);
        this.opLog.unshift({
            date: ANCHOR,
            time: nowTime(),
            user: actor.name,
            role: actor.roleLabel,
            action: "新建销售订单",
            target: orderNo,
        });
        this.version += 1;
        return order;
    }

    updateOrder(input: {
        orderNo: string;
        qty?: number;
        deliverStart?: string;
        deliverEnd?: string;
        remark?: string;
    }): Order {
        const order = this.orders.find(item => item.orderNo === input.orderNo);
        if (!order) throw new Error("订单不存在");
        if (input.qty !== undefined && input.qty < order.outbound) {
            throw new Error(`新数量不能低于累计已发 ${order.outbound} 件`);
        }
        const nextStart = input.deliverStart ?? order.deliverStart;
        const nextEnd = input.deliverEnd ?? order.deliverEnd;
        if (nextEnd < nextStart) throw new Error("交货截止日期不能早于起始日期");
        if (input.qty !== undefined) order.qty = input.qty;
        order.deliverStart = nextStart;
        order.deliverEnd = nextEnd;
        if (input.remark !== undefined) order.remark = input.remark;
        this.version += 1;
        return order;
    }

    /** 校验并解析所属销售账号 → 姓名（须为在职 sales 用户） */
    private ownerNameOf(ownerAccount: string): string {
        const owner = this.users.find(item => item.account === ownerAccount.trim() && item.active);
        if (!owner || owner.role !== "sales") throw new Error("客户负责人须为在职销售账号");
        return owner.name;
    }

    createCustomer(input: {
        name: string;
        contact: string;
        phone: string;
        province: string;
        city: string;
        district: string;
        town: string;
        address: string;
        ownerAccount: string;
        payTerms: string;
    }): Customer {
        const owner = this.ownerNameOf(input.ownerAccount);
        const maxSeq = this.customers.reduce((max, customer) => Math.max(max, Number(customer.code.slice(-4)) || 0), 0);
        const customer: Customer = {
            code: `CUS-${String(maxSeq + 1).padStart(4, "0")}`,
            name: input.name,
            contact: input.contact,
            phone: `${input.phone.slice(0, 3)}****${input.phone.slice(-4)}`,
            province: input.province,
            city: input.city,
            district: input.district,
            town: input.town,
            address: input.address,
            cooperation: "待跟进",
            owner,
            payTerms: input.payTerms ?? "",
            created: ANCHOR,
        };
        this.customers.unshift(customer);
        this.version += 1;
        return { ...customer, cooperation: this.cooperationOf(customer.code) };
    }

    updateCustomer(
        code: string,
        input: {
            name: string;
            contact: string;
            phone: string;
            province: string;
            city: string;
            district: string;
            town: string;
            address: string;
            ownerAccount: string;
            payTerms: string;
        },
    ): Customer {
        const customer = this.customers.find(item => item.code === code);
        if (!customer) throw new Error("客户不存在");
        const owner = this.ownerNameOf(input.ownerAccount);
        customer.name = input.name;
        customer.contact = input.contact;
        // 编辑时电话留空 = 不修改（库表存的是掩码，无法回填完整号）
        if (input.phone) customer.phone = `${input.phone.slice(0, 3)}****${input.phone.slice(-4)}`;
        customer.province = input.province;
        customer.city = input.city;
        customer.district = input.district;
        customer.town = input.town;
        customer.address = input.address;
        customer.owner = owner;
        customer.payTerms = input.payTerms ?? "";
        this.version += 1;
        return { ...customer, cooperation: this.cooperationOf(customer.code) };
    }

    createBom(input: { name: string; modelCode: string; specs: Record<string, string> }): Bom {
        const code = nextBomCode(input.name, this.boms);
        const bom: Bom = {
            code,
            name: input.name,
            modelCode: input.modelCode,
            specs: { ...input.specs },
            spec: "",
            created: ANCHOR,
            unit: "个",
        };
        bom.spec = specOf(bom);
        this.boms.unshift(bom);
        this.version += 1;
        return bom;
    }

    createInbound(input: { bomCode: string; qty: number; date: string; remark: string }, actor: Actor): InboundRow {
        const bom = this.bomByCode(input.bomCode);
        if (!bom) throw new Error("成品不存在");
        if (!Number.isSafeInteger(input.qty) || input.qty <= 0) throw new Error("请输入有效的入库数量");
        if (!input.date) throw new Error("请选择入库日期");
        const rows = this.inboundLedger.filter(row => row.date === input.date);
        const seq = rows.length > 0 ? Math.max(...rows.map(row => Number(row.no.slice(-4)))) + 1 : 1;
        const row: InboundRow = {
            no: `RK-${input.date.replaceAll("-", "")}-${String(seq).padStart(4, "0")}`,
            bomCode: input.bomCode,
            qty: input.qty,
            date: input.date,
            time: nowTime(),
            // 登记人取当前登录用户（不经请求体）
            inspector: actor.name,
            remark: input.remark,
        };
        this.inboundLedger.push(row);
        this.stock.set(input.bomCode, (this.stock.get(input.bomCode) || 0) + input.qty);
        this.version += 1;
        return row;
    }

    createOutbound(input: { orderNo: string; qty: number; date: string; remark: string }, actor: Actor): OutboundRow {
        const order = this.orders.find(item => item.orderNo === input.orderNo);
        if (!order) throw new Error("订单不存在");
        if (!Number.isSafeInteger(input.qty) || input.qty <= 0) throw new Error("请输入有效的发货数量");
        if (!input.date) throw new Error("请选择出库日期");
        if (input.qty > maxShipOf(this.snapshot(), input.orderNo)) throw new Error("可发库存已变化，请重新核对数量");
        const orderRows = this.outboundLedger.filter(row => row.date === input.date);
        const seq = orderRows.length > 0 ? Math.max(...orderRows.map(row => Number(row.no.slice(-4)))) + 1 : 1;
        const row: OutboundRow = {
            no: `CK-${input.date.replaceAll("-", "")}-${String(seq).padStart(4, "0")}`,
            orderNo: order.orderNo,
            customer: order.customer,
            customerCode: order.customerCode,
            bomCode: order.bomCode,
            qty: input.qty,
            date: input.date,
            time: nowTime(),
            // 操作人取当前登录用户（不经请求体）
            operator: actor.name,
            remark: input.remark,
        };
        this.outboundLedger.push(row);
        order.outbound = Math.min(order.qty, order.outbound + input.qty);
        this.stock.set(order.bomCode, Math.max(0, (this.stock.get(order.bomCode) || 0) - input.qty));
        this.opLog.unshift({
            date: ANCHOR,
            time: row.time,
            user: actor.name,
            role: actor.roleLabel,
            action: "登记发货",
            target: row.no,
        });
        this.version += 1;
        return row;
    }

    snapshot(): Snapshot {
        return {
            version: this.version,
            orders: this.orders.map(order => ({ ...order })),
            boms: this.boms.map(bom => ({ ...bom, specs: { ...bom.specs } })),
            customers: this.listCustomers(),
            inboundLedger: this.inboundLedger.map(row => ({ ...row })),
            outboundLedger: this.outboundLedger.map(row => ({ ...row })),
            stock: Object.fromEntries(this.stock),
            users: this.listUsers(),
        };
    }

    createUser(input: { name: string; account: string; role: WbUser["role"] }): WbUser {
        if (this.users.some(item => item.account === input.account.trim())) {
            throw new Error("账号已存在");
        }
        if (!/^[A-Za-z0-9_]{3,}$/.test(input.account.trim())) {
            throw new Error("账号需为字母/数字/下划线，至少 3 位");
        }
        const nextId = Math.max(0, ...this.users.map(user => user.id)) + 1;
        const user: DbUser = {
            id: nextId,
            name: input.name,
            account: input.account.trim(),
            role: input.role,
            active: true,
            last: "—",
            password: MOCK_PASSWORD,
        };
        this.users.push(user);
        this.version += 1;
        const { password: _password, ...rest } = user;
        return { ...rest };
    }

    updateUser(account: string, input: { name: string; role: WbUser["role"] }): WbUser {
        const user = this.users.find(item => item.account === account);
        if (!user) throw new Error("用户不存在");
        user.name = input.name;
        if (user.role !== "super") user.role = input.role;
        this.version += 1;
        const { password: _password, ...rest } = user;
        return { ...rest };
    }

    setUserActive(account: string, active: boolean): WbUser {
        const user = this.users.find(item => item.account === account);
        if (!user) throw new Error("用户不存在");
        if (user.role === "super") throw new Error("超级管理员不可停用");
        user.active = active;
        this.version += 1;
        const { password: _password, ...rest } = user;
        return { ...rest };
    }
}

/* 授权持久化：模拟 sys_grant 表的落库（Node 环境跳过） */
function loadGrants(): GrantMap {
    const merged = buildDefaultGrants();
    if (typeof localStorage === "undefined") return merged;
    try {
        const raw = localStorage.getItem(GRANT_LS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as { version?: number; grants?: GrantMap };
            if (parsed?.version === GRANT_LS_VERSION && parsed.grants) {
                ROLES.forEach(({ id }) => {
                    if (parsed.grants![id]) merged[id] = parsed.grants![id];
                });
            }
        }
    } catch {
        // 损坏数据回落默认
    }
    return merged;
}

function persistGrants(grants: GrantMap) {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(GRANT_LS_KEY, JSON.stringify({ version: GRANT_LS_VERSION, grants }));
    } catch {
        // 存储失败不影响本次会话
    }
}

export const db = new MockDb();
db.init();
