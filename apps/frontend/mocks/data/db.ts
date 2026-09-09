/* Mock 内存数据库（原 src/data/store.ts 迁移）
 * - 日期锚点动态取「今天」，种子数据按相对天数生成，演示数据始终新鲜
 * - mulberry32 固定种子：同一天内刷新结果一致
 * - 不变量：每 BOM Σ入库 − Σ出库 = 当前可用库存
 * - 仅授权（grants）落 localStorage 模拟后端持久化；Node 环境下自动跳过
 * - 无浏览器顶层 API，可被 node --test 直接导入 */
import type { Bom, Customer, InboundRow, OpLogEntry, Order, OutboundRow, Snapshot, SystemEvent, WbUser } from "@/api";
// 注意：本文件被 node --test 直跑（scripts/inventory.test.mjs），Node 不解析 "@/ 别名，
// 因此运行时值导入保留相对路径 + .ts 扩展名；type 导入会被擦除，可用别名
import type { GrantMap, RoleGrant, RoleId } from "@/data/permissions";
import { ROLES, buildDefaultGrants } from "../../src/data/permissions.ts";
import type { GrantLogEntry } from "@/api";
import { categoryOf, defaultsOf, nextBomCode } from "../../src/data/categories.ts";
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

const CONTACT_SEEDS: Array<[string, string, string, string]> = [
    // 联系人 / 电话 / 地区 / 城市
    ["王建国", "138****6821", "华东", "苏州"],
    ["李雪梅", "139****3417", "华南", "东莞"],
    ["张伟", "137****9055", "华东", "苏州"],
    ["陈静", "136****2764", "华东", "杭州"],
    ["刘强", "135****8391", "华东", "宁波"],
    ["赵敏", "158****6142", "华东", "上海"],
    ["孙丽", "186****4529", "华南", "深圳"],
    ["周涛", "150****7385", "华南", "广州"],
    ["吴昊", "133****2968", "西南", "成都"],
    ["郑爽", "155****5073", "华北", "天津"],
];

const buildCustomers = (): Customer[] =>
    CUSTOMER_SEEDS.map(([name, code], index) => {
        const [contact, phone, region, city] = CONTACT_SEEDS[index];
        const full = phone.replace("****", String(1000 + index * 137).slice(0, 4));
        return {
            code,
            name,
            contact,
            phone,
            phoneFull: full,
            region,
            city,
            address: `${city}${["高新区工业园 8 号", "经济开发区兴业路 21 号", "临港产业园 3 栋", "科技城创新大厦 12F"][index % 4]}`,
            status: index === 8 || index === 9 ? "待跟进" : "合作中",
            owner: "李晓梅",
            payTerms: "月结 30 天",
            created: addDays(ANCHOR, -(120 + index * 37)),
        };
    });

// 33 条人工审核旋转开关主数据（编码 ZMXK001 起，specs 键值对见品类模板）
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

// 微动 / 跌倒开关样例数据（演示多品类建档与筛选）
const EXTRA_BOMS: Array<Pick<Bom, "code" | "name" | "modelCode" | "specs">> = [
    {
        code: "ZMKW001",
        name: "微动开关",
        modelCode: "KW-1",
        specs: { 触点形式: "常开", 动作力: "160gf", 行程: "0.25mm", 额定电流: "5A 250VAC" },
    },
    {
        code: "ZMKW002",
        name: "微动开关",
        modelCode: "KW-2",
        specs: { 触点形式: "常闭", 动作力: "120gf", 行程: "0.20mm", 额定电流: "10A 250VAC" },
    },
    {
        code: "ZMKW003",
        name: "微动开关",
        modelCode: "KW-3",
        specs: { 触点形式: "转换", 动作力: "200gf", 行程: "0.30mm", 额定电流: "3A 125VAC" },
    },
    {
        code: "ZMDD001",
        name: "跌倒开关",
        modelCode: "DD-1",
        specs: { 感应角度: "±30°", 输出信号: "常开", 额定电流: "2A 30VDC" },
    },
    {
        code: "ZMDD002",
        name: "跌倒开关",
        modelCode: "DD-2",
        specs: { 感应角度: "±45°", 输出信号: "常闭", 额定电流: "1A 30VDC" },
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
            code: `ZMXK${String(index + 1).padStart(3, "0")}`,
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
    return [
        ...rotaryBoms,
        ...EXTRA_BOMS.map(row => ({
            ...row,
            spec: specOf(row),
            created: addDays(ANCHOR, -3),
            unit: "个",
        })),
    ];
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
            deliverDate: addDays(orderDate, deliverInDays),
            remark: "",
            seedStock,
        };
    };
    return [
        mk(86, 4, 15, 0, "ZMXK001", 2400, 0, 1600),
        mk(85, 4, 19, 1, "ZMXK002", 800, 0, 0),
        mk(84, 5, 13, 2, "ZMXK003", 1200, 1200, 0),
        mk(83, 6, 11, 3, "ZMKW001", 560, 560, 0),
        mk(82, 7, 20, 4, "ZMXK005", 3000, 0, 1200),
        mk(81, 8, 17, 5, "ZMDD001", 960, 0, 0),
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
        const [customer, customerCode] = CUSTOMER_SEEDS[(seq * 7) % CUSTOMER_SEEDS.length];
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
            deliverDate: addDays(orderDate, 12 + (seq % 8)),
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
    systemEvents: SystemEvent[] = [
        {
            level: "高优先级",
            levelTone: "danger",
            module: "物料与 BOM",
            item: "订单引用的 BOM 版本信息缺失",
            ref: "ZM260830081",
            found: `${addDays(ANCHOR, -3).slice(5)} 16:20`,
            state: "待核对",
            open: true,
        },
        {
            level: "业务校验",
            levelTone: "warning",
            module: "成品出库",
            item: "超出可发库存的发货被拦截",
            ref: "ZM260903086",
            found: `${addDays(ANCHOR, -2).slice(5)} 10:12`,
            state: "已拦截",
            open: true,
        },
        {
            level: "配置变更",
            levelTone: "info",
            module: "系统管理",
            item: "检验员角色菜单权限变更",
            ref: "ROLE-INSPECTOR",
            found: `${addDays(ANCHOR, -2).slice(5)} 09:30`,
            state: "已生效",
            open: true,
        },
        {
            level: "提示",
            levelTone: "neutral",
            module: "客户档案",
            item: "疑似重复客户资料待合并",
            ref: "CUS-0906",
            found: `${addDays(ANCHOR, -4).slice(5)} 14:05`,
            state: "待核对",
            open: false,
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

    private timeOf(seedIndex: number) {
        return `${String(8 + (seedIndex % 9)).padStart(2, "0")}:${String((seedIndex * 17) % 60).padStart(2, "0")}`;
    }

    private buildOutboundLedger(): OutboundRow[] {
        const raw: Array<Omit<OutboundRow, "no">> = [];
        const shipped = this.orders.filter(order => order.outbound > 0);
        const recent = [...shipped]
            .sort((a, b) => a.deliverDate.localeCompare(b.deliverDate))
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
                    date = clampDate(addDays(order.deliverDate, -randInt(0, 3)), addDays(ANCHOR, -55), ANCHOR);
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
            const seq = (counter.get(row.date) || 18) + 1;
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
            const seq = (counter.get(row.date) || 24) + 1;
            counter.set(row.date, seq);
            return { ...row, no: `RK-${row.date.replaceAll("-", "")}-${String(seq).padStart(4, "0")}` };
        });
    }

    private buildOpLog(): OpLogEntry[] {
        const entries: OpLogEntry[] = [];
        const push = (date: string, time: string, user: string, role: string, action: string, target: string) =>
            entries.push({ date, time, user, role, action, target });
        this.outboundLedger
            .filter(row => row.date === ANCHOR)
            .forEach(row =>
                push(
                    ANCHOR,
                    row.time,
                    row.operator,
                    row.operator === "周丽" ? "仓库管理员" : "检验员",
                    "发货登记",
                    row.no,
                ),
            );
        this.inboundLedger
            .filter(row => row.date === ANCHOR)
            .forEach(row => push(ANCHOR, row.time, row.inspector, "检验员", "成品入库", row.no));
        const newestOrder = staticOrders()[0]?.orderNo ?? "—";
        push(ANCHOR, "09:12", "李晓梅", "管理员", "新建销售订单", newestOrder);
        push(ANCHOR, "08:47", "李晓梅", "管理员", "新建客户档案", "CUS-0906");
        push(ANCHOR, "09:30", "系统管理员", "超级管理员", "权限变更", "ROLE-INSPECTOR");
        [1, 2, 3].forEach(offset => {
            const day = addDays(ANCHOR, -offset);
            this.outboundLedger
                .filter(row => row.date === day)
                .slice(0, 3)
                .forEach(row =>
                    push(
                        day,
                        row.time,
                        row.operator,
                        row.operator === "周丽" ? "仓库管理员" : "检验员",
                        "发货登记",
                        row.no,
                    ),
                );
            this.inboundLedger
                .filter(row => row.date === day)
                .slice(0, 2)
                .forEach(row => push(day, row.time, row.inspector, "检验员", "成品入库", row.no));
        });
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
        const yyMMdd = input.orderDate.slice(2).replaceAll("-", "");
        const maxSeq = this.orders.reduce((max, order) => Math.max(max, Number(order.orderNo.slice(-3)) || 0), 0);
        const orderNo = `ZM${yyMMdd}${String(maxSeq + 1).padStart(3, "0")}`;
        const order: Order = {
            orderNo,
            customer: input.customer,
            customerCode: input.customerCode,
            bomCode: input.bomCode,
            qty: input.qty,
            outbound: 0,
            orderDate: input.orderDate,
            deliverDate: input.deliverEnd,
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

    updateOrder(
        input: { orderNo: string; qty?: number; deliverDate?: string; remark?: string; reason?: string },
        actor: Actor,
    ): Order {
        const order = this.orders.find(item => item.orderNo === input.orderNo);
        if (!order) throw new Error("订单不存在");
        if (input.qty !== undefined && input.qty !== order.qty && (input.reason || "").trim().length < 4) {
            throw new Error("修改订单数量必须填写至少 4 个字的修改原因");
        }
        if (input.qty !== undefined) order.qty = input.qty;
        if (input.deliverDate) order.deliverDate = input.deliverDate;
        if (input.remark !== undefined) order.remark = input.remark;
        if (input.reason && input.reason.trim()) {
            this.opLog.unshift({
                date: ANCHOR,
                time: nowTime(),
                user: actor.name,
                role: actor.roleLabel,
                action: "修改销售订单",
                target: `${order.orderNo}（${input.reason.trim()}）`,
            });
        }
        this.version += 1;
        return order;
    }

    createCustomer(
        input: { name: string; contact: string; phone: string; region: string; address: string; remark: string },
        actor: Actor,
    ): Customer {
        const maxSeq = this.customers.reduce((max, customer) => Math.max(max, Number(customer.code.slice(-4)) || 0), 0);
        const customer: Customer = {
            code: `CUS-${String(maxSeq + 1).padStart(4, "0")}`,
            name: input.name,
            contact: input.contact,
            phone: `${input.phone.slice(0, 3)}****${input.phone.slice(-4)}`,
            phoneFull: input.phone,
            region: input.region,
            city:
                input.region === "华东"
                    ? "苏州"
                    : input.region === "华南"
                      ? "深圳"
                      : input.region === "华北"
                        ? "北京"
                        : "成都",
            address: input.address,
            status: "待跟进",
            owner: actor.name,
            payTerms: "月结 30 天",
            created: ANCHOR,
        };
        this.customers.unshift(customer);
        this.opLog.unshift({
            date: ANCHOR,
            time: nowTime(),
            user: actor.name,
            role: actor.roleLabel,
            action: "新建客户档案",
            target: customer.code,
        });
        this.version += 1;
        return customer;
    }

    createBom(input: { name: string; modelCode: string; specs: Record<string, string> }): Bom {
        const code = nextBomCode(
            input.name,
            this.boms.map(bom => bom.code),
        );
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

    createInbound(
        input: { bomCode: string; qty: number; date: string; inspector: string; remark: string },
        actor: Actor,
    ): InboundRow {
        const bom = this.bomByCode(input.bomCode);
        if (!bom) throw new Error("成品不存在");
        if (!Number.isSafeInteger(input.qty) || input.qty <= 0) throw new Error("请输入有效的入库数量");
        if (!input.date) throw new Error("请选择入库日期");
        const rows = this.inboundLedger.filter(row => row.date === input.date);
        const seq = rows.length > 0 ? Math.max(...rows.map(row => Number(row.no.slice(-4)))) + 1 : 25;
        const row: InboundRow = {
            no: `RK-${input.date.replaceAll("-", "")}-${String(seq).padStart(4, "0")}`,
            bomCode: input.bomCode,
            qty: input.qty,
            date: input.date,
            time: nowTime(),
            inspector: input.inspector,
            remark: input.remark,
        };
        this.inboundLedger.push(row);
        this.stock.set(input.bomCode, (this.stock.get(input.bomCode) || 0) + input.qty);
        this.opLog.unshift({
            date: ANCHOR,
            time: row.time,
            user: actor.name,
            role: actor.roleLabel,
            action: "成品入库",
            target: row.no,
        });
        this.version += 1;
        return row;
    }

    createOutbound(
        input: { orderNo: string; qty: number; date: string; operator: string; remark: string },
        actor: Actor,
    ): OutboundRow {
        const order = this.orders.find(item => item.orderNo === input.orderNo);
        if (!order) throw new Error("订单不存在");
        if (!Number.isSafeInteger(input.qty) || input.qty <= 0) throw new Error("请输入有效的发货数量");
        if (!input.date) throw new Error("请选择出库日期");
        if (input.qty > maxShipOf(this.snapshot(), input.orderNo)) throw new Error("可发库存已变化，请重新核对数量");
        const orderRows = this.outboundLedger.filter(row => row.date === input.date);
        const seq = orderRows.length > 0 ? Math.max(...orderRows.map(row => Number(row.no.slice(-4)))) + 1 : 19;
        const row: OutboundRow = {
            no: `CK-${input.date.replaceAll("-", "")}-${String(seq).padStart(4, "0")}`,
            orderNo: order.orderNo,
            customer: order.customer,
            customerCode: order.customerCode,
            bomCode: order.bomCode,
            qty: input.qty,
            date: input.date,
            time: nowTime(),
            operator: input.operator,
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
            action: "发货登记",
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
            customers: this.customers.map(customer => ({ ...customer })),
            inboundLedger: this.inboundLedger.map(row => ({ ...row })),
            outboundLedger: this.outboundLedger.map(row => ({ ...row })),
            stock: Object.fromEntries(this.stock),
            users: this.listUsers(),
            systemEvents: this.systemEvents.map(event => ({ ...event })),
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
