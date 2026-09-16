/* Mock 内存数据库（原 src/data/store.ts 迁移）
 * - 日期锚点动态取「今天」
 * - 物料目录模式：品类/分区/分组/物料目录由 categories.ts 播种；BOM、订单、
 *   出入库、库存、日志一律从 0 开始，由使用者建档/开单逐步生成（与真实后端一致）
 * - 不变量：每 BOM Σ有效入库 + Σ库存调整 − Σ有效出库净额 = 当前可用库存
 * - 仅授权（grants）落 localStorage 模拟后端持久化；Node 环境下自动跳过
 * - 无浏览器顶层 API，可被 node --test 直接导入 */
import type {
    Bom,
    Customer,
    InboundRow,
    OpLogEntry,
    Order,
    OutboundPrintDocument,
    OutboundRow,
    Snapshot,
    StockAdjustmentRow,
    WbUser,
} from "@/api";
// 注意：本文件被 node --test 直跑（scripts/inventory.test.mjs），Node 不解析 "@/ 别名，
// 因此运行时值导入保留相对路径 + .ts 扩展名；type 导入会被擦除，可用别名
import type { GrantMap, RoleGrant, RoleId } from "@/data/permissions";
import { ACTION_CATALOG, MENU_CATALOG, ROLES, buildDefaultGrants } from "../../src/data/permissions.ts";
import type { GrantLogEntry } from "@/api";
import { bomSpecOfItems, BOM_CATEGORIES, catalogRowsOf, categoryOf, nextBomCode } from "../../src/data/categories.ts";
import { addDays, addMonths, nowStamp, nowTime, todayIso } from "../../src/lib/date.ts";
import { maxShipOf } from "../../src/data/views.ts";

export const ANCHOR = todayIso();

const isIsoDate = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const [, year, month, day] = match.map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};

const assertIsoDate = (value: string, label: string) => {
    if (!isIsoDate(value)) throw new Error(`${label}格式不正确`);
};

/** 操作人（来自当前 token），写台账/日志时落名 */
export interface Actor {
    account?: string;
    role?: RoleId;
    name: string;
    roleLabel: string;
}

interface InboundChangeLog {
    inboundNo: string;
    action: "update" | "void";
    before: InboundRow;
    after: InboundRow;
    reason: string;
    operator: string;
    time: string;
}

interface CustomerOwnerHistory {
    customerCode: string;
    fromAccount: string;
    toAccount: string;
    reason: string;
    operator: string;
    time: string;
}

interface SalesOrderChangeLog {
    orderNo: string;
    event: "create" | "update" | "cancel";
    before: Order | null;
    after: Order;
    reason: string;
    operator: string;
    time: string;
}

interface OutboundQuantityEvent {
    eventNo: string;
    shipmentNo: string;
    qtyDelta: number;
    correctionOf?: string;
    reason?: string;
    operator: string;
    time: string;
}

interface OutboundStateLog {
    shipmentNo: string;
    event: "register" | "print" | "reprint" | "void-pre-print" | "void-emergency";
    beforeState: OutboundRow["state"] | null;
    afterState: OutboundRow["state"];
    beforeVersion: number | null;
    afterVersion: number;
    reason: string;
    operator: string;
    time: string;
    detail?: Record<string, boolean | number | string>;
}

interface OutboundPrintLog {
    shipmentNo: string;
    printVersion: number;
    printedBy: string;
    reason: string;
    documentSnapshot: OutboundPrintDocument;
    printedAt: string;
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
            version: 1,
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
            ownerAccount: "chen_jie",
            payTerms: "月结 30 天",
            created: addDays(ANCHOR, -(120 + index * 37)),
        };
    });

/* ---- 内存库（handler 侧单例） ---- */
const MOCK_PASSWORD = "123456";
const GRANT_LS_KEY = "zm-permissions";
const GRANT_LS_VERSION = 3;

type DbUser = WbUser & { password: string; tokenVersion: number };

class MockDb {
    orders: Order[] = [];
    boms: Bom[] = [];
    customers: Customer[] = [];
    inboundLedger: InboundRow[] = [];
    outboundLedger: OutboundRow[] = [];
    stockAdjustments: StockAdjustmentRow[] = [];
    inboundChangeLog: InboundChangeLog[] = [];
    customerOwnerHistory: CustomerOwnerHistory[] = [];
    salesOrderChangeLog: SalesOrderChangeLog[] = [];
    outboundQuantityEvents: OutboundQuantityEvent[] = [];
    outboundStateLog: OutboundStateLog[] = [];
    outboundPrintLog: OutboundPrintLog[] = [];
    stock = new Map<string, number>();
    users: DbUser[] = [
        {
            version: 1,
            name: "系统管理员",
            account: "sys_admin",
            role: "super",
            active: true,
            last: `${addDays(ANCHOR, 0).slice(5)} 08:12`,
            createdAt: `${addDays(ANCHOR, -365)}T08:30:00+08:00`,
            updatedAt: `${addDays(ANCHOR, -100)}T10:20:00+08:00`,
            password: MOCK_PASSWORD,
            tokenVersion: 1,
        },
        {
            version: 1,
            name: "李晓梅",
            account: "li_xiaomei",
            role: "admin",
            active: true,
            last: `${addDays(ANCHOR, 0).slice(5)} 09:40`,
            createdAt: `${addDays(ANCHOR, -200)}T10:15:00+08:00`,
            updatedAt: `${addDays(ANCHOR, -45)}T11:00:00+08:00`,
            password: MOCK_PASSWORD,
            tokenVersion: 1,
        },
        {
            version: 1,
            name: "陈志强",
            account: "chen_zhiqiang",
            role: "admin",
            active: true,
            last: `${addDays(ANCHOR, -1).slice(5)} 17:22`,
            createdAt: `${addDays(ANCHOR, -180)}T09:00:00+08:00`,
            updatedAt: `${addDays(ANCHOR, -60)}T15:30:00+08:00`,
            password: MOCK_PASSWORD,
            tokenVersion: 1,
        },
        {
            version: 1,
            name: "周丽",
            account: "zhou_li",
            role: "warehouse",
            active: true,
            last: `${addDays(ANCHOR, 0).slice(5)} 08:55`,
            createdAt: `${addDays(ANCHOR, -150)}T14:20:00+08:00`,
            updatedAt: `${addDays(ANCHOR, -20)}T09:50:00+08:00`,
            password: MOCK_PASSWORD,
            tokenVersion: 1,
        },
        {
            version: 1,
            name: "王师傅",
            account: "wang_shifu",
            role: "warehouse",
            active: true,
            last: `${addDays(ANCHOR, -2).slice(5)} 16:03`,
            createdAt: `${addDays(ANCHOR, -120)}T11:05:00+08:00`,
            updatedAt: `${addDays(ANCHOR, -15)}T14:10:00+08:00`,
            password: MOCK_PASSWORD,
            tokenVersion: 1,
        },
        {
            version: 1,
            name: "赵师傅",
            account: "zhao_shifu",
            role: "warehouse",
            active: true,
            last: `${addDays(ANCHOR, -3).slice(5)} 11:20`,
            createdAt: `${addDays(ANCHOR, -90)}T16:40:00+08:00`,
            updatedAt: `${addDays(ANCHOR, -80)}T10:05:00+08:00`,
            password: MOCK_PASSWORD,
            tokenVersion: 1,
        },
        {
            version: 1,
            name: "陈洁",
            account: "chen_jie",
            role: "sales",
            active: true,
            last: `${addDays(ANCHOR, 0).slice(5)} 09:12`,
            createdAt: `${addDays(ANCHOR, -60)}T09:45:00+08:00`,
            updatedAt: `${addDays(ANCHOR, -10)}T16:25:00+08:00`,
            password: MOCK_PASSWORD,
            tokenVersion: 1,
        },
        {
            version: 1,
            name: "刘敏",
            account: "liu_min",
            role: "staff",
            active: true,
            last: `${addDays(ANCHOR, -4).slice(5)} 15:44`,
            createdAt: `${addDays(ANCHOR, -30)}T13:30:00+08:00`,
            password: MOCK_PASSWORD,
            tokenVersion: 1,
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
        // 物料目录模式（与真实后端一致）：目录随 categories.ts 播种，业务数据从 0 开始——
        // BOM、订单、出入库、库存、日志全部为空，由使用者建档/开单逐步生成
        this.boms = [];
        this.orders = [];
        this.customers = buildCustomers();
        this.inboundLedger = [];
        this.outboundLedger = [];
        this.stockAdjustments = [];
        this.inboundChangeLog = [];
        this.salesOrderChangeLog = [];
        this.outboundQuantityEvents = [];
        this.outboundStateLog = [];
        this.outboundPrintLog = [];
        this.opLog = [];
        this.stock.clear();
    }

    bomByCode(code: string) {
        return this.boms.find(bom => bom.code === code);
    }

    stockOf(bomCode: string) {
        return Math.max(0, this.stock.get(bomCode) || 0);
    }

    remainingOf(order: Order) {
        return order.lifecycleStatus === "cancelled" ? 0 : Math.max(0, order.qty - order.outbound);
    }

    listUsers(): WbUser[] {
        return this.users.map(({ password: _password, tokenVersion: _tokenVersion, ...user }) => ({ ...user }));
    }

    /** 合作状态（聚合派生，不落库）：近 6 个日历月有活动订单 = 合作中，否则待跟进 */
    private cooperationOf(customerCode: string): "合作中" | "待跟进" {
        const windowStart = addMonths(ANCHOR, -6);
        return this.orders.some(
            order =>
                order.customerCode === customerCode &&
                order.lifecycleStatus === "active" &&
                order.orderDate >= windowStart,
        )
            ? "合作中"
            : "待跟进";
    }

    listCustomers(): Customer[] {
        return this.customers.map(customer => ({ ...customer, cooperation: this.cooperationOf(customer.code) }));
    }

    // ---- 认证 ----

    verifyLogin(account: string, password: string): DbUser | null {
        const user = this.users.find(item => item.account === account.trim());
        if (!user || !user.active || user.password !== password) return null;
        user.last = nowStamp();
        return user;
    }

    issueToken(account: string): string {
        const user = this.users.find(item => item.account === account);
        if (!user || !user.active) throw new Error("账号不存在或已停用");
        return `mock.${account}.${user.tokenVersion}.${Date.now().toString(36)}`;
    }

    resolveToken(token: string): DbUser | null {
        const segments = token.split(".");
        if (segments.length === 4 && segments[0] === "mock") {
            const user = this.users.find(item => item.account === segments[1]);
            return user && user.active && String(user.tokenVersion) === segments[2] ? user : null;
        }
        return null;
    }

    /** 个人中心：修改自己的密码（旧密码校验 + 新密码 ≥6 位；不强制改密）。
        姓名等资料为管理员域，由 updateUser 维护，不提供自助改名 */
    changePassword(account: string, oldPassword: string, newPassword: string): void {
        const user = this.users.find(item => item.account === account);
        if (!user || !user.active) throw new Error("账号不存在或已停用");
        if (user.password !== oldPassword) throw new Error("旧密码不正确");
        if (newPassword.length < 6) throw new Error("新密码至少 6 位");
        user.password = newPassword;
        user.tokenVersion += 1;
        user.version += 1;
        user.updatedAt = new Date().toISOString();
    }

    // ---- 授权 ----

    getGrant(role: RoleId): RoleGrant {
        return this.grants[role];
    }

    saveGrants(role: RoleId, grant: RoleGrant, expectedVersion: number, note: string, actor: Actor) {
        const current = this.grants[role];
        if (current.version !== expectedVersion) throw new Error("角色授权已被其他人修改，请刷新后重试");
        const knownMenus = new Set(
            MENU_CATALOG.flatMap(menu => [menu.key, ...(menu.children ?? []).map(child => child.key)]),
        );
        if (grant.menus.some(menu => !knownMenus.has(menu))) throw new Error("授权中包含未知菜单");
        if (grant.menus.some(menu => menu === "permissions" || menu.startsWith("permissions-"))) {
            throw new Error("受保护的用户与权限菜单只能由超级管理员持有");
        }
        for (const [menu, actions] of Object.entries(grant.actions)) {
            const catalog = (ACTION_CATALOG as Record<string, readonly { id: string; protected?: boolean }[]>)[menu];
            if (!catalog || actions.some(action => !catalog.some(item => item.id === action))) {
                throw new Error("授权中包含未知操作");
            }
            if (actions.some(action => catalog.find(item => item.id === action)?.protected)) {
                throw new Error("受保护权限只能由超级管理员持有");
            }
            if (actions.length > 0 && (!grant.menus.includes(menu) || !actions.includes("view"))) {
                throw new Error("操作权限必须同时包含父菜单和查看权限");
            }
        }
        const normalized = {
            version: current.version,
            menus: [...new Set(grant.menus)],
            actions: Object.fromEntries(
                Object.entries(grant.actions).map(([menu, actions]) => [menu, [...new Set(actions)]]),
            ),
        };
        const unchanged =
            JSON.stringify({ menus: normalized.menus, actions: normalized.actions }) ===
            JSON.stringify({ menus: current.menus, actions: current.actions });
        if (unchanged) {
            this.grantLog.unshift({
                time: `${todayIso().slice(5)} ${nowTime()}`,
                user: actor.name,
                text: note.trim() || `角色【${role}】授权保存（无变化）`,
            });
            return structuredClone(current);
        }
        const saved = structuredClone({ ...normalized, version: current.version + 1 });
        this.grants = { ...this.grants, [role]: saved };
        persistGrants(this.grants);
        this.grantLog.unshift({
            time: `${todayIso().slice(5)} ${nowTime()}`,
            user: actor.name,
            text: note.trim() || `角色【${role}】授权保存（无补充原因）`,
        });
        return saved;
    }

    // ---- 变更操作（校验与单号规则同旧版，日志落操作人） ----

    createOrder(
        input: {
            customerCode: string;
            bomCode: string;
            qty: number;
            deliverDate: string;
            orderDate: string;
            remark: string;
        },
        actor: Actor,
    ): Order {
        const customer = this.customers.find(item => item.code === input.customerCode);
        if (!customer) throw new Error("客户不存在");
        if (!this.bomByCode(input.bomCode)) throw new Error("成品不存在");
        if (!Number.isSafeInteger(input.qty) || input.qty <= 0) throw new Error("请输入有效的订单数量");
        assertIsoDate(input.orderDate, "订单日期");
        assertIsoDate(input.deliverDate, "交货日期");
        const yyMMdd = input.orderDate.slice(2).replaceAll("-", "");
        // 按日递增取号：单号日期段来自 orderDate，序号取「同日已有订单」最大值 + 1
        const sameDay = this.orders.filter(order => order.orderNo.startsWith(`ZM${yyMMdd}`));
        const maxSeq = sameDay.reduce((max, order) => Math.max(max, Number(order.orderNo.slice(-3)) || 0), 0);
        const orderNo = `ZM${yyMMdd}${String(maxSeq + 1).padStart(3, "0")}`;
        const order: Order = {
            version: 1,
            orderNo,
            customer: customer.name,
            customerCode: input.customerCode,
            bomCode: input.bomCode,
            qty: input.qty,
            outbound: 0,
            orderDate: input.orderDate,
            deliverDate: input.deliverDate,
            remark: input.remark,
            lifecycleStatus: "active",
        };
        this.orders.unshift(order);
        this.salesOrderChangeLog.unshift({
            orderNo,
            event: "create",
            before: null,
            after: { ...order },
            reason: "",
            operator: actor.name,
            time: new Date().toISOString(),
        });
        this.opLog.unshift({
            date: ANCHOR,
            time: nowTime(),
            user: actor.name,
            role: actor.roleLabel,
            action: "新建销售订单",
            target: orderNo,
        });
        this.version += 1;
        return { ...order };
    }

    updateOrder(
        input: {
            orderNo: string;
            expectedVersion: number;
            qty?: number;
            deliverDate?: string;
            remark?: string;
        },
        actor: Actor,
    ): Order {
        const order = this.orders.find(item => item.orderNo === input.orderNo);
        if (!order) throw new Error("订单不存在");
        if (order.version !== input.expectedVersion) throw new Error("订单已被其他人修改，请刷新后重试");
        if (order.lifecycleStatus === "cancelled") throw new Error("已取消订单不可修改");
        if (input.qty !== undefined && (!Number.isSafeInteger(input.qty) || input.qty <= 0)) {
            throw new Error("请输入有效的订单数量");
        }
        if (input.qty !== undefined && input.qty < order.outbound) {
            throw new Error(`新数量不能低于累计已发 ${order.outbound} 件`);
        }
        const nextDeliverDate = input.deliverDate ?? order.deliverDate;
        assertIsoDate(nextDeliverDate, "交货日期");
        const before = { ...order };
        if (input.qty !== undefined) order.qty = input.qty;
        order.deliverDate = nextDeliverDate;
        if (input.remark !== undefined) order.remark = input.remark;
        order.version += 1;
        this.salesOrderChangeLog.unshift({
            orderNo: order.orderNo,
            event: "update",
            before,
            after: { ...order },
            reason: "",
            operator: actor.name,
            time: new Date().toISOString(),
        });
        this.version += 1;
        return { ...order };
    }

    cancelOrder(orderNo: string, expectedVersion: number, reason: string, actor: Actor): Order {
        const order = this.orders.find(item => item.orderNo === orderNo);
        if (!order) throw new Error("订单不存在");
        if (order.version !== expectedVersion) throw new Error("订单已被其他人修改，请刷新后重试");
        if (order.lifecycleStatus === "cancelled") return { ...order };
        if (reason.trim().length < 2) throw new Error("请填写取消原因（至少 2 个字）");
        const pendingShipments = this.outboundLedger.filter(
            row => row.orderNo === orderNo && row.state === "registered",
        );
        if (pendingShipments.length > 0) throw new Error("存在已登记但未打印的出库单，请先作废后再取消订单");
        if (order.outbound >= order.qty) throw new Error("订单已全部发货，没有剩余数量可以取消");
        const before = { ...order };
        order.lifecycleStatus = "cancelled";
        order.cancelReason = reason.trim();
        order.cancelledBy = actor.name;
        order.cancelledAt = new Date().toISOString();
        order.version += 1;
        this.salesOrderChangeLog.unshift({
            orderNo: order.orderNo,
            event: "cancel",
            before,
            after: { ...order },
            reason: reason.trim(),
            operator: actor.name,
            time: order.cancelledAt,
        });
        this.version += 1;
        return { ...order };
    }

    /** 校验并解析负责人账号（须为在职 sales 或 super 用户） */
    private ownerOf(ownerAccount: string): DbUser {
        const owner = this.users.find(item => item.account === ownerAccount.trim() && item.active);
        if (!owner || !["sales", "super"].includes(owner.role))
            throw new Error("客户负责人须为在职销售或超级管理员账号");
        return owner;
    }

    /* 新建/编辑共用的字段校验，长度上限对齐 openapi Create/UpdateCustomerInput */
    private assertCustomerInput(input: {
        name: string;
        contact: string;
        province: string;
        city: string;
        district: string;
        town: string;
        address: string;
        payTerms: string;
    }) {
        if (input.name.trim().length < 4 || input.name.trim().length > 80) throw new Error("客户名称须为 4-80 个字符");
        if (!input.contact.trim() || input.contact.trim().length > 32) throw new Error("客户联系人须为 1-32 个字符");
        if (input.province.length > 64 || input.city.length > 64) throw new Error("省份/城市最多 64 个字符");
        if (input.district.length > 64) throw new Error("县区最多 64 个字符");
        if (input.town.length > 96) throw new Error("乡镇最多 96 个字符");
        if (input.address.length > 300) throw new Error("详细地址最多 300 个字符");
        if ((input.payTerms ?? "").length > 160) throw new Error("付款条件最多 160 个字符");
    }

    createCustomer(
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
        actor: Actor,
    ): Customer {
        this.assertCustomerInput(input);
        if (!/^1\d{10}$/.test(input.phone)) throw new Error("请输入 11 位手机号");
        const owner = this.ownerOf(input.ownerAccount);
        const maxSeq = this.customers.reduce((max, customer) => Math.max(max, Number(customer.code.slice(-4)) || 0), 0);
        const customer: Customer = {
            version: 1,
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
            owner: owner.name,
            ownerAccount: owner.account,
            payTerms: input.payTerms ?? "",
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
        return { ...customer, cooperation: this.cooperationOf(customer.code) };
    }

    updateCustomer(
        code: string,
        input: {
            expectedVersion: number;
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
        actor: Actor,
    ): Customer {
        const customer = this.customers.find(item => item.code === code);
        if (!customer) throw new Error("客户不存在");
        if (customer.version !== input.expectedVersion) throw new Error("客户已被其他人修改，请刷新后重试");
        this.assertCustomerInput(input);
        if (input.phone && !/^1\d{10}$/.test(input.phone)) throw new Error("请输入 11 位手机号");
        const owner = this.ownerOf(input.ownerAccount);
        const previousOwner = customer.ownerAccount;
        customer.name = input.name;
        customer.contact = input.contact;
        // 编辑时电话留空 = 不修改（库表存的是掩码，无法回填完整号）
        if (input.phone) customer.phone = `${input.phone.slice(0, 3)}****${input.phone.slice(-4)}`;
        customer.province = input.province;
        customer.city = input.city;
        customer.district = input.district;
        customer.town = input.town;
        customer.address = input.address;
        customer.owner = owner.name;
        customer.ownerAccount = owner.account;
        customer.payTerms = input.payTerms ?? "";
        customer.version += 1;
        if (previousOwner !== owner.account) {
            this.customerOwnerHistory.unshift({
                customerCode: customer.code,
                fromAccount: previousOwner,
                toAccount: owner.account,
                reason: "单个客户负责人变更",
                operator: actor.name,
                time: new Date().toISOString(),
            });
        }
        this.version += 1;
        return { ...customer, cooperation: this.cooperationOf(customer.code) };
    }

    createBom(input: { name: string; materialItemIds: string[] }): Bom {
        const category = categoryOf(input.name.trim());
        if (!category) throw new Error("品类不存在");
        if (!Array.isArray(input.materialItemIds) || input.materialItemIds.length === 0) {
            throw new Error("请至少选择一项物料");
        }
        const rows = catalogRowsOf(category);
        const rowById = new Map(rows.map(row => [row.id, row]));
        const selected = [...new Set(input.materialItemIds)].map(id => {
            const row = rowById.get(id);
            if (!row) throw new Error("物料不存在、已停用或不属于该品类");
            return row;
        });
        const byGroup = new Map<string, { groupName: string; multi: boolean; count: number }>();
        const multiOf = new Map(
            category.groups.filter(node => node.kind === "group").map(node => [node.key, node.multi ?? false]),
        );
        for (const row of selected) {
            const bucket = byGroup.get(row.groupKey) ?? {
                groupName: row.groupName,
                multi: multiOf.get(row.groupKey) ?? false,
                count: 0,
            };
            bucket.count += 1;
            byGroup.set(row.groupKey, bucket);
        }
        for (const { groupName, multi, count } of byGroup.values()) {
            if (!multi && count > 1) throw new Error(`分组「${groupName}」只能选择一项物料`);
        }
        const identity = JSON.stringify([
            category.key,
            [...new Set(input.materialItemIds)].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)),
        ]);
        const duplicate = this.boms.find(
            bom =>
                JSON.stringify([
                    category.key,
                    bom.items.map(item => item.materialId).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)),
                ]) === identity,
        );
        if (duplicate) throw new Error(`BOM 已存在：${duplicate.code}`);
        const code = nextBomCode(category, this.boms);
        // 建档冻结快照：明细按目录序（position）落 items；modelCode 由 model 组派生
        const selectedIds = new Set(input.materialItemIds);
        const items = rows
            .filter(row => selectedIds.has(row.id))
            .map(row => ({ materialId: row.id, groupKey: row.groupKey, groupName: row.groupName, name: row.name }));
        const bom: Bom = {
            code,
            name: category.name,
            modelCode: items.find(item => item.groupKey === "model")?.name ?? "",
            items,
            spec: bomSpecOfItems(items),
            created: ANCHOR,
            unit: "个",
        };
        this.boms.unshift(bom);
        this.version += 1;
        return structuredClone(bom);
    }

    createInbound(input: { bomCode: string; qty: number; date: string; remark: string }, actor: Actor): InboundRow {
        const bom = this.bomByCode(input.bomCode);
        if (!bom) throw new Error("成品不存在");
        if (!Number.isSafeInteger(input.qty) || input.qty <= 0) throw new Error("请输入有效的入库数量");
        assertIsoDate(input.date, "入库日期");
        // 当天录入当天入库（db-scheme §7）：日期由前端固定为今天，后端同样拒绝非当天日期
        if (input.date !== ANCHOR) throw new Error("入库日期固定为当天，不能选择其他日期");
        const rows = this.inboundLedger.filter(row => row.date === input.date);
        // 单号 = RK + yyMMdd + 两位日序号（前缀 RK+6 位日期共 8 字符，序号自第 8 位起解析，超宽自然增长）
        const seq = rows.length > 0 ? Math.max(...rows.map(row => Number(row.no.slice(8)))) + 1 : 1;
        const row: InboundRow = {
            no: `RK${input.date.slice(2).replaceAll("-", "")}${String(seq).padStart(2, "0")}`,
            bomCode: input.bomCode,
            qty: input.qty,
            date: input.date,
            time: nowTime(),
            // 登记人取当前登录用户（不经请求体）
            inspector: actor.name,
            remark: input.remark,
            status: "active",
            version: 1,
            createdAt: `${ANCHOR}T${nowTime()}:00+08:00`,
        };
        this.inboundLedger.push(row);
        this.stock.set(input.bomCode, (this.stock.get(input.bomCode) || 0) + input.qty);
        this.version += 1;
        return { ...row };
    }

    private assertInboundEditable(row: InboundRow) {
        const createdDate = row.createdAt.includes("T") ? row.createdAt.slice(0, 10) : row.date;
        if (createdDate !== ANCHOR) throw new Error("只能修正北京时间当天录入的入库记录");
        if (row.status === "voided") throw new Error("已作废入库记录不可再次修改");
    }

    updateInbound(
        no: string,
        input: { expectedVersion: number; bomCode: string; qty: number; date: string; remark: string; reason: string },
        actor: Actor,
    ): InboundRow {
        const row = this.inboundLedger.find(item => item.no === no);
        if (!row) throw new Error("入库记录不存在");
        this.assertInboundEditable(row);
        if (row.version !== input.expectedVersion) throw new Error("入库记录已被其他人修改，请刷新后重试");
        if (!Number.isSafeInteger(input.qty) || input.qty <= 0) throw new Error("请输入有效的入库数量");
        if (input.reason.trim().length < 2) throw new Error("请填写修正原因（至少 2 个字）");
        assertIsoDate(input.date, "入库日期");
        if (input.date !== ANCHOR) throw new Error("入库日期固定为当天，不能选择其他日期");
        if (!this.bomByCode(input.bomCode)) throw new Error("成品不存在");
        const oldStock = this.stock.get(row.bomCode) ?? 0;
        const nextOldStock = row.bomCode === input.bomCode ? oldStock + input.qty - row.qty : oldStock - row.qty;
        if (nextOldStock < 0) throw new Error("修正后库存将小于 0，请先核对相关出库记录");
        const before = { ...row };
        if (row.bomCode !== input.bomCode) {
            this.stock.set(row.bomCode, nextOldStock);
            this.stock.set(input.bomCode, (this.stock.get(input.bomCode) ?? 0) + input.qty);
        } else {
            this.stock.set(row.bomCode, nextOldStock);
        }
        row.bomCode = input.bomCode;
        row.qty = input.qty;
        row.date = input.date;
        row.remark = input.remark;
        row.version += 1;
        row.updatedBy = actor.name;
        row.updatedAt = new Date().toISOString();
        this.inboundChangeLog.unshift({
            inboundNo: row.no,
            action: "update",
            before,
            after: { ...row },
            reason: input.reason.trim(),
            operator: actor.name,
            time: row.updatedAt,
        });
        this.version += 1;
        return { ...row };
    }

    voidInbound(no: string, expectedVersion: number, reason: string, actor: Actor): InboundRow {
        const row = this.inboundLedger.find(item => item.no === no);
        if (!row) throw new Error("入库记录不存在");
        this.assertInboundEditable(row);
        if (row.version !== expectedVersion) throw new Error("入库记录已被其他人修改，请刷新后重试");
        if (reason.trim().length < 2) throw new Error("请填写作废原因（至少 2 个字）");
        const nextStock = (this.stock.get(row.bomCode) ?? 0) - row.qty;
        if (nextStock < 0) throw new Error("作废后库存将小于 0，请先核对相关出库记录");
        const before = { ...row };
        this.stock.set(row.bomCode, nextStock);
        row.status = "voided";
        row.version += 1;
        row.updatedBy = actor.name;
        row.updatedAt = new Date().toISOString();
        this.inboundChangeLog.unshift({
            inboundNo: row.no,
            action: "void",
            before,
            after: { ...row },
            reason: reason.trim(),
            operator: actor.name,
            time: row.updatedAt,
        });
        this.version += 1;
        return { ...row };
    }

    createStockAdjustment(
        input: { bomCode: string; qtyDelta: number; date: string; reason: string; relatedInboundNo?: string },
        actor: Actor,
    ): StockAdjustmentRow {
        if (!this.bomByCode(input.bomCode)) throw new Error("成品不存在");
        if (!Number.isSafeInteger(input.qtyDelta) || input.qtyDelta === 0) throw new Error("调整数量必须是非零整数");
        if (input.reason.trim().length < 2) throw new Error("请填写调整原因（至少 2 个字）");
        assertIsoDate(input.date, "调整日期");
        if (input.relatedInboundNo) {
            const related = this.inboundLedger.find(row => row.no === input.relatedInboundNo);
            if (!related) throw new Error("关联入库单不存在");
            if (related.bomCode !== input.bomCode) throw new Error("库存调整与关联入库单的 BOM 必须一致");
        }
        const nextStock = (this.stock.get(input.bomCode) ?? 0) + input.qtyDelta;
        if (nextStock < 0) throw new Error("调整后库存不能小于 0");
        const sameDay = this.stockAdjustments.filter(row => row.date === input.date);
        const seq = sameDay.length + 1;
        const row: StockAdjustmentRow = {
            no: `TZ-${input.date.replaceAll("-", "")}-${String(seq).padStart(4, "0")}`,
            bomCode: input.bomCode,
            qtyDelta: input.qtyDelta,
            date: input.date,
            time: nowTime(),
            operator: actor.name,
            reason: input.reason.trim(),
            relatedInboundNo: input.relatedInboundNo,
        };
        this.stockAdjustments.push(row);
        this.stock.set(input.bomCode, nextStock);
        this.version += 1;
        return { ...row };
    }

    createOutbound(input: { orderNo: string; qty: number; date: string; remark: string }, actor: Actor): OutboundRow {
        const order = this.orders.find(item => item.orderNo === input.orderNo);
        if (!order) throw new Error("订单不存在");
        if (order.lifecycleStatus === "cancelled") throw new Error("订单已取消，不能登记发货");
        if (!Number.isSafeInteger(input.qty) || input.qty <= 0) throw new Error("请输入有效的发货数量");
        assertIsoDate(input.date, "出库日期");
        if (input.qty > maxShipOf(this.snapshot(), input.orderNo)) throw new Error("可发库存已变化，请重新核对数量");
        const orderRows = this.outboundLedger.filter(row => row.date === input.date);
        // 单号 = CK + yyMMdd + 两位日序号（前缀 CK+6 位日期共 8 字符，序号自第 8 位起解析，超宽自然增长）
        const seq = orderRows.length > 0 ? Math.max(...orderRows.map(row => Number(row.no.slice(8)))) + 1 : 1;
        const row: OutboundRow = {
            no: `CK${input.date.slice(2).replaceAll("-", "")}${String(seq).padStart(2, "0")}`,
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
            state: "registered",
            version: 1,
            printVersion: 0,
        };
        this.outboundLedger.push(row);
        this.outboundQuantityEvents.push({
            eventNo: `${row.no}-E01`,
            shipmentNo: row.no,
            qtyDelta: row.qty,
            operator: actor.name,
            time: new Date().toISOString(),
        });
        this.outboundStateLog.unshift({
            shipmentNo: row.no,
            event: "register",
            beforeState: null,
            afterState: "registered",
            beforeVersion: null,
            afterVersion: row.version,
            reason: "",
            operator: actor.name,
            time: new Date().toISOString(),
        });
        order.outbound += input.qty;
        order.version += 1;
        this.stock.set(order.bomCode, (this.stock.get(order.bomCode) ?? 0) - input.qty);
        this.opLog.unshift({
            date: ANCHOR,
            time: row.time,
            user: actor.name,
            role: actor.roleLabel,
            action: "登记发货",
            target: row.no,
        });
        this.version += 1;
        return { ...row };
    }

    voidOutbound(no: string, expectedVersion: number, reason: string, actor: Actor): OutboundRow {
        if (actor.role !== "warehouse" && actor.role !== "super") throw new Error("仅仓管或超级管理员可作废出库单");
        const row = this.outboundLedger.find(item => item.no === no);
        if (!row) throw new Error("出库单不存在");
        if (row.version !== expectedVersion) throw new Error("出库单已被其他人处理，请刷新后重试");
        if (row.state !== "registered") throw new Error("只有未打印的出库单可以由仓管作废");
        if (reason.trim().length < 2) throw new Error("请填写作废原因（至少 2 个字）");
        const order = this.orders.find(item => item.orderNo === row.orderNo)!;
        const beforeVersion = row.version;
        row.state = "voided";
        row.voidReason = reason.trim();
        row.version += 1;
        order.outbound -= row.qty;
        order.version += 1;
        this.stock.set(row.bomCode, (this.stock.get(row.bomCode) ?? 0) + row.qty);
        this.outboundQuantityEvents.push({
            eventNo: `${row.no}-E02`,
            shipmentNo: row.no,
            qtyDelta: -row.qty,
            correctionOf: `${row.no}-E01`,
            reason: reason.trim(),
            operator: actor.name,
            time: new Date().toISOString(),
        });
        this.outboundStateLog.unshift({
            shipmentNo: row.no,
            event: "void-pre-print",
            beforeState: "registered",
            afterState: "voided",
            beforeVersion,
            afterVersion: row.version,
            reason: reason.trim(),
            operator: actor.name,
            time: new Date().toISOString(),
        });
        this.version += 1;
        return { ...row };
    }

    printOutbound(no: string, expectedVersion: number, reason: string, actor: Actor) {
        const row = this.outboundLedger.find(item => item.no === no);
        if (!row) throw new Error("出库单不存在");
        if (row.version !== expectedVersion) throw new Error("出库单已被其他人处理，请刷新后重试");
        if (row.state === "voided") throw new Error("已作废出库单不能打印");
        const order = this.orders.find(item => item.orderNo === row.orderNo)!;
        if (order.lifecycleStatus === "cancelled" && row.state === "registered") {
            throw new Error("订单已取消，不能首次打印出库单");
        }
        if (row.state === "printed" && reason.trim().length < 2) throw new Error("重打必须填写原因");
        const beforeState = row.state;
        const beforeVersion = row.version;
        row.state = "printed";
        row.printVersion += 1;
        row.version += 1;
        order.version += 1;
        const printedAt = new Date().toISOString();
        const document: OutboundPrintDocument = {
            no: row.no,
            printVersion: row.printVersion,
            orderNo: row.orderNo,
            customer: row.customer,
            customerCode: row.customerCode,
            bomCode: row.bomCode,
            bomSpec: this.bomByCode(row.bomCode)?.spec ?? "",
            qty: row.qty,
            date: row.date,
            operator: row.operator,
            remark: row.remark ?? "",
            printedBy: actor.name,
            printedAt,
        };
        this.outboundPrintLog.unshift({
            shipmentNo: row.no,
            printVersion: row.printVersion,
            printedBy: actor.name,
            reason: reason.trim(),
            documentSnapshot: { ...document },
            printedAt,
        });
        this.outboundStateLog.unshift({
            shipmentNo: row.no,
            event: beforeState === "printed" ? "reprint" : "print",
            beforeState,
            afterState: "printed",
            beforeVersion,
            afterVersion: row.version,
            reason: reason.trim(),
            operator: actor.name,
            time: printedAt,
            detail: { printVersion: row.printVersion },
        });
        this.version += 1;
        return { outbound: { ...row }, printVersion: row.printVersion, document };
    }

    emergencyVoidOutbound(
        no: string,
        expectedVersion: number,
        reason: string,
        goodsNotDeparted: boolean,
        paperInvalidated: boolean,
        actor: Actor,
    ): OutboundRow {
        if (actor.role !== "super") throw new Error("仅超级管理员可紧急撤销已打印出库单");
        const row = this.outboundLedger.find(item => item.no === no);
        if (!row) throw new Error("出库单不存在");
        if (row.version !== expectedVersion) throw new Error("出库单已被其他人处理，请刷新后重试");
        if (row.state !== "printed") throw new Error("只有已打印出库单需要紧急撤销");
        if (!goodsNotDeparted || !paperInvalidated) throw new Error("必须确认货物尚未离开且纸质单已作废");
        if (reason.trim().length < 2) throw new Error("请填写紧急撤销原因（至少 2 个字）");
        const order = this.orders.find(item => item.orderNo === row.orderNo)!;
        const beforeVersion = row.version;
        row.state = "voided";
        row.voidReason = reason.trim();
        row.version += 1;
        order.outbound -= row.qty;
        order.version += 1;
        this.stock.set(row.bomCode, (this.stock.get(row.bomCode) ?? 0) + row.qty);
        const voidedAt = new Date().toISOString();
        this.outboundQuantityEvents.push({
            eventNo: `${row.no}-E02`,
            shipmentNo: row.no,
            qtyDelta: -row.qty,
            correctionOf: `${row.no}-E01`,
            reason: reason.trim(),
            operator: actor.name,
            time: voidedAt,
        });
        this.outboundStateLog.unshift({
            shipmentNo: row.no,
            event: "void-emergency",
            beforeState: "printed",
            afterState: "voided",
            beforeVersion,
            afterVersion: row.version,
            reason: reason.trim(),
            operator: actor.name,
            time: voidedAt,
            detail: { goodsNotDeparted, paperInvalidated },
        });
        this.version += 1;
        return { ...row };
    }

    snapshot(): Snapshot {
        return {
            version: this.version,
            orders: this.orders.map(order => ({ ...order })),
            boms: structuredClone(this.boms),
            bomCategories: structuredClone(BOM_CATEGORIES),
            customers: this.listCustomers(),
            inboundLedger: this.inboundLedger.map(row => ({ ...row })),
            outboundLedger: this.outboundLedger.map(row => ({ ...row })),
            stockAdjustments: this.stockAdjustments.map(row => ({ ...row })),
            stock: Object.fromEntries(this.stock),
            users: this.listUsers(),
            customerOwnerOptions: this.listUsers()
                .filter(user => ["sales", "super"].includes(user.role) && user.active)
                .map(({ name, account }) => ({ name, account })),
        };
    }

    createUser(input: { name: string; account: string; role: WbUser["role"] }): WbUser {
        if (this.users.some(item => item.account === input.account.trim())) {
            throw new Error("账号已存在");
        }
        if (!/^[A-Za-z0-9_]{3,}$/.test(input.account.trim())) {
            throw new Error("账号需为字母/数字/下划线，至少 3 位");
        }
        if (input.role === "super") throw new Error("不能通过接口新增超级管理员");
        if (!(ROLES.map(role => role.id) as string[]).includes(input.role)) throw new Error("角色不存在");
        if (!input.name.trim() || input.name.trim().length > 20) throw new Error("姓名须为 1-20 个字符");
        const user: DbUser = {
            version: 1,
            name: input.name,
            account: input.account.trim(),
            role: input.role,
            active: true,
            last: "—",
            createdAt: new Date().toISOString(),
            password: MOCK_PASSWORD,
            tokenVersion: 1,
        };
        this.users.push(user);
        this.version += 1;
        const { password: _password, tokenVersion: _tokenVersion, ...rest } = user;
        return { ...rest };
    }

    private transferCustomers(fromAccount: string, toAccount: string, reason: string, actor: Actor) {
        const replacement = this.ownerOf(toAccount);
        if (replacement.account === fromAccount) throw new Error("接任销售不能是原负责人");
        if (reason.trim().length < 2) throw new Error("请填写客户移交原因（至少 2 个字）");
        this.customers
            .filter(customer => customer.ownerAccount === fromAccount)
            .forEach(customer => {
                customer.owner = replacement.name;
                customer.ownerAccount = replacement.account;
                customer.version += 1;
                this.customerOwnerHistory.unshift({
                    customerCode: customer.code,
                    fromAccount,
                    toAccount: replacement.account,
                    reason: reason.trim(),
                    operator: actor.name,
                    time: new Date().toISOString(),
                });
            });
    }

    updateUser(
        account: string,
        input: {
            expectedVersion: number;
            name: string;
            role: WbUser["role"];
            replacementOwnerAccount?: string;
            transferReason?: string;
        },
        actor: Actor,
    ): WbUser {
        const user = this.users.find(item => item.account === account);
        if (!user) throw new Error("用户不存在");
        if (user.version !== input.expectedVersion) throw new Error("用户已被其他人修改，请刷新后重试");
        if (input.role === "super" && user.role !== "super") throw new Error("不能将用户修改为超级管理员");
        if (!(ROLES.map(role => role.id) as string[]).includes(input.role)) throw new Error("角色不存在");
        if (user.role === "sales" && input.role !== "sales") {
            const count = this.customers.filter(customer => customer.ownerAccount === account).length;
            if (count > 0) {
                if (!input.replacementOwnerAccount) throw new Error(`该销售仍负责 ${count} 个客户，请先选择接任销售`);
                this.transferCustomers(account, input.replacementOwnerAccount, input.transferReason ?? "", actor);
            }
        }
        const roleChanged = user.role !== "super" && user.role !== input.role;
        user.name = input.name;
        if (user.role !== "super") user.role = input.role;
        if (roleChanged) user.tokenVersion += 1;
        user.version += 1;
        user.updatedAt = new Date().toISOString();
        this.version += 1;
        const { password: _password, tokenVersion: _tokenVersion, ...rest } = user;
        return { ...rest };
    }

    setUserActive(
        account: string,
        input: {
            expectedVersion: number;
            active: boolean;
            replacementOwnerAccount?: string;
            transferReason?: string;
        },
        actor: Actor,
    ): WbUser {
        const user = this.users.find(item => item.account === account);
        if (!user) throw new Error("用户不存在");
        if (user.version !== input.expectedVersion) throw new Error("用户已被其他人修改，请刷新后重试");
        if (user.role === "super") throw new Error("超级管理员不可停用");
        if (!input.active && user.role === "sales") {
            const count = this.customers.filter(customer => customer.ownerAccount === account).length;
            if (count > 0) {
                if (!input.replacementOwnerAccount) throw new Error(`该销售仍负责 ${count} 个客户，请先选择接任销售`);
                this.transferCustomers(account, input.replacementOwnerAccount, input.transferReason ?? "", actor);
            }
        }
        if (user.active !== input.active) user.tokenVersion += 1;
        user.active = input.active;
        user.version += 1;
        user.updatedAt = new Date().toISOString();
        this.version += 1;
        const { password: _password, tokenVersion: _tokenVersion, ...rest } = user;
        return { ...rest };
    }

    /** 重置为初始密码 123456：改密即递增 token_version，对方旧会话立即失效 */
    resetUserPassword(
        account: string,
        input: {
            expectedVersion: number;
        },
        _actor: Actor,
    ): WbUser {
        const user = this.users.find(item => item.account === account);
        if (!user) throw new Error("用户不存在");
        if (user.version !== input.expectedVersion) throw new Error("用户已被其他人修改，请刷新后重试");
        if (user.role === "super") throw new Error("超级管理员密码不可重置");
        user.password = "123456";
        user.tokenVersion += 1;
        user.version += 1;
        user.updatedAt = new Date().toISOString();
        this.version += 1;
        const { password: _password, tokenVersion: _tokenVersion, ...rest } = user;
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
