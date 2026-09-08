/* 智造管理系统 · 数据层（移植自原型 workbench-data.js，确定性 mock）
 * - 锚定日 2026-09-07；mulberry32 固定种子，刷新结果一致
 * - 不变量：每 BOM Σ入库 − Σ出库 = 当前可用库存；状态计数合计 = 订单总数
 */
import type {
  Bom,
  Customer,
  InboundRow,
  OpLogEntry,
  Order,
  OrderStatus,
  OutboundRow,
  PendingVsStockRow,
  ReadyToShipRow,
  RiskOrderRow,
  Snapshot,
  StockGapRow,
  SystemEvent,
  TopCustomerRow,
  TrendRow,
  WbUser,
} from "./types";

export const ANCHOR = "2026-09-07";
const DAY = 86400000;
const toMs = (isoDate: string) =>
  Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10)));
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (isoDate: string, n: number) => toIso(toMs(isoDate) + n * DAY);
export { addDays };
const clampDate = (isoDate: string, min: string, max: string) =>
  isoDate < min ? min : isoDate > max ? max : isoDate;

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

// 33 条人工审核 BOM 主数据
const BOM_ROWS: Array<Omit<Bom, "spec" | "created" | "name" | "model" | "unit">> = [
  { code: "ZM001", modelCode: "1-1", seriesLabel: "二脚", gear: "一档", gearSpec: "211-1", gearDir: "正面", thickness: "0.2", spring: "0.5" },
  { code: "ZM002", modelCode: "2-1", seriesLabel: "三脚", gear: "两档", gearSpec: "222-1", gearDir: "正面", thickness: "0.2", spring: "0.5" },
  { code: "ZM003", modelCode: "2-1", seriesLabel: "四脚", gear: "两档", gearSpec: "2-1-4", gearDir: "正面", thickness: "0.2", spring: "0.5" },
  { code: "ZM004", modelCode: "2-2", seriesLabel: "三脚", gear: "两档", gearSpec: "222-2", gearDir: "正面", thickness: "0.2", spring: "0.5" },
  { code: "ZM005", modelCode: "3-1", seriesLabel: "五脚", gear: "三档", gearSpec: "233-4", gearDir: "正面", thickness: "0.2", spring: "0.5" },
  { code: "ZM006", modelCode: "3-2", seriesLabel: "三脚", gear: "三档", gearSpec: "233-1-B", gearDir: "反面", thickness: "0.2", spring: "0.5" },
  { code: "ZM007", modelCode: "3-2", seriesLabel: "五脚", gear: "三档", gearSpec: "233-1", gearDir: "反面", thickness: "0.2", spring: "0.5" },
  { code: "ZM008", modelCode: "4-1", seriesLabel: "六脚", gear: "四档", gearSpec: "", gearDir: "正面", thickness: "0.2", spring: "0.5" },
  { code: "ZM009", modelCode: "4-2", seriesLabel: "五脚", gear: "四档", gearSpec: "243-1-2", gearDir: "正面", thickness: "0.2", spring: "0.5" },
  { code: "ZM010", modelCode: "4-3", seriesLabel: "三脚", gear: "四档", gearSpec: "243-5B", gearDir: "正面反轴", thickness: "0.2", spring: "0.5" },
  { code: "ZM011", modelCode: "4-3", seriesLabel: "五脚", gear: "四档", gearSpec: "243-5A", gearDir: "正面反轴", thickness: "0.2", spring: "0.5" },
  { code: "ZM012", modelCode: "4-3", seriesLabel: "五脚", gear: "四档", gearSpec: "243-5", gearDir: "反面转90°扇位朝上", thickness: "0.2", spring: "0.5" },
  { code: "ZM013", modelCode: "4-4", seriesLabel: "五脚", gear: "四档", gearSpec: "243-1", gearDir: "反面", thickness: "0.2", spring: "0.5" },
  { code: "ZM014", modelCode: "4-8", seriesLabel: "五脚", gear: "四档", gearSpec: "", gearDir: "正面", thickness: "0.2", spring: "0.5" },
  { code: "ZM015", modelCode: "4-9", seriesLabel: "五脚", gear: "四档", gearSpec: "", gearDir: "正面", thickness: "0.2", spring: "0.5" },
  { code: "ZM016", modelCode: "0-2", seriesLabel: "六脚", gear: "八档", gearSpec: "全方位/冷风扇/284-1B", gearDir: "正面", thickness: "0.2", spring: "0.55" },
  { code: "ZM017", modelCode: "0-2", seriesLabel: "六脚", gear: "八档", gearSpec: "全方位/冷风扇/284-1B", gearDir: "正面转90°扇位朝上", thickness: "0.3", spring: "0.55" },
  { code: "ZM018", modelCode: "0-2", seriesLabel: "五脚", gear: "八档", gearSpec: "全方位/284-2B", gearDir: "正面", thickness: "0.2", spring: "0.55" },
  { code: "ZM019", modelCode: "0-3", seriesLabel: "三脚", gear: "两档", gearSpec: "212-1", gearDir: "正面", thickness: "0.2", spring: "0.55" },
  { code: "ZM020", modelCode: "0-3", seriesLabel: "五脚", gear: "四档", gearSpec: "263-1-A", gearDir: "正面", thickness: "0.2", spring: "0.55" },
  { code: "ZM021", modelCode: "0-3", seriesLabel: "五脚", gear: "四档", gearSpec: "263-1-A", gearDir: "正面反轴", thickness: "0.2", spring: "0.55" },
  { code: "ZM022", modelCode: "0-4", seriesLabel: "六脚", gear: "八档", gearSpec: "284-1A", gearDir: "正面", thickness: "0.2", spring: "0.5" },
  { code: "ZM023", modelCode: "0-4-1", seriesLabel: "六脚", gear: "八档", gearSpec: "284-2", gearDir: "正面", thickness: "0.2", spring: "0.55" },
  { code: "ZM024", modelCode: "0-4", seriesLabel: "五脚", gear: "八档", gearSpec: "284-1", gearDir: "正面", thickness: "0.2", spring: "0.5" },
  { code: "ZM025", modelCode: "0-5", seriesLabel: "六脚", gear: "八档", gearSpec: "284-3", gearDir: "正面", thickness: "0.2", spring: "0.55" },
  { code: "ZM026", modelCode: "0-5", seriesLabel: "六脚", gear: "八档", gearSpec: "", gearDir: "正面", thickness: "0.3", spring: "0.55" },
  { code: "ZM027", modelCode: "0-5", seriesLabel: "五脚", gear: "八档", gearSpec: "284-4", gearDir: "正面", thickness: "0.2", spring: "0.55" },
  { code: "ZM028", modelCode: "0-6", seriesLabel: "六脚", gear: "五档", gearSpec: "", gearDir: "正面", thickness: "0.2", spring: "0.6" },
  { code: "ZM029", modelCode: "0-7", seriesLabel: "五脚", gear: "四档", gearSpec: "", gearDir: "正面", thickness: "0.2", spring: "0.6" },
  { code: "ZM030", modelCode: "0-8", seriesLabel: "三脚", gear: "四档", gearSpec: "", gearDir: "反面", thickness: "0.2", spring: "0.55" },
  { code: "ZM031", modelCode: "0-9", seriesLabel: "五脚", gear: "", gearSpec: "", gearDir: "", thickness: "0.2", spring: "0.55" },
  { code: "ZM032", modelCode: "0-9-1", seriesLabel: "五脚", gear: "六档", gearSpec: "全方位", gearDir: "反面", thickness: "0.2", spring: "0.55" },
  { code: "ZM033", modelCode: "3-1", seriesLabel: "五脚", gear: "三档", gearSpec: "", gearDir: "", thickness: "0.2", spring: "0.5" },
];

const specOf = (row: Pick<Bom, "seriesLabel" | "modelCode" | "gear" | "gearSpec" | "gearDir" | "thickness" | "spring">) =>
  [
    `${row.seriesLabel} ${row.modelCode}`,
    [row.gear, row.gearSpec, row.gearDir].filter(Boolean).join(" "),
    `银点${row.thickness}`,
    `弹簧规格${row.spring}`,
  ]
    .filter(Boolean)
    .join(" · ");

const buildBoms = (): Bom[] =>
  BOM_ROWS.map((row) => ({
    ...row,
    spec: specOf(row),
    created: "2026-09-04",
    name: "旋转开关",
    model: "XK2",
    unit: "个",
  }));

const INSPECTORS = ["王师傅", "赵师傅", "周丽"];
const OPERATORS = ["王师傅", "周丽", "赵师傅"];

// 6 条静态订单（单号格式与主原型一致 ZM+YYMMDD+序号；seedStock 为原型台账的既有库存）
const STATIC_ORDERS: SeededOrder[] = [
  { orderNo: "ZM260903086", customer: "华兴精密制造", customerCode: "CUS-1024", bomCode: "ZM001", qty: 2400, outbound: 0, orderDate: "2026-09-03", deliverDate: "2026-09-18", remark: "", seedStock: 1600 },
  { orderNo: "ZM260903085", customer: "东莞启程电子", customerCode: "CUS-0316", bomCode: "ZM002", qty: 800, outbound: 0, orderDate: "2026-09-03", deliverDate: "2026-09-22", remark: "", seedStock: 0 },
  { orderNo: "ZM260902084", customer: "苏州新锐汽车", customerCode: "CUS-0788", bomCode: "ZM003", qty: 1200, outbound: 1200, orderDate: "2026-09-02", deliverDate: "2026-09-15", remark: "", seedStock: 0 },
  { orderNo: "ZM260901083", customer: "杭州微控科技", customerCode: "CUS-0542", bomCode: "ZM004", qty: 560, outbound: 560, orderDate: "2026-09-01", deliverDate: "2026-09-12", remark: "", seedStock: 0 },
  { orderNo: "ZM260831082", customer: "宁波博远工业", customerCode: "CUS-0210", bomCode: "ZM005", qty: 3000, outbound: 0, orderDate: "2026-08-31", deliverDate: "2026-09-20", remark: "", seedStock: 1200 },
  { orderNo: "ZM260830081", customer: "上海恒拓设备", customerCode: "CUS-1190", bomCode: "ZM006", qty: 960, outbound: 0, orderDate: "2026-08-30", deliverDate: "2026-09-16", remark: "", seedStock: 0 },
];

type SeededOrder = Order & { seedStock: number };

function buildOrders(boms: Bom[]): SeededOrder[] {
  const plan = [...Array<string>(63).fill("已完成"), ...Array<string>(11).fill("可发货"), ...Array<string>(6).fill("待生产")];
  const seeded: SeededOrder[] = plan.map((status, index) => {
    const seq = 80 - index;
    const [customer, customerCode] = CUSTOMER_SEEDS[(seq * 7) % CUSTOMER_SEEDS.length];
    const bom = boms[(seq * 3) % boms.length];
    const qty = 300 + ((seq * 137) % 4200);
    const done = status === "已完成" ? qty : status === "可发货" ? Math.floor(qty * (0.2 + (seq % 5) * 0.15)) : 0;
    const orderDate = addDays("2026-08-29", -Math.floor(index / 2));
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
  return [...STATIC_ORDERS.map((order) => ({ ...order })), ...seeded];
}

// ---- Store（可变内存库 + 派生视图） ----
class WbStore {
  orders: Order[] = [];
  boms: Bom[] = [];
  customers: Customer[] = [];
  inboundLedger: InboundRow[] = [];
  outboundLedger: OutboundRow[] = [];
  stock = new Map<string, number>();
  users: WbUser[] = [
    { name: "李晓梅", role: "管理员", account: "li_xiaomei" },
    { name: "陈志强", role: "管理员", account: "chen_zhiqiang" },
    { name: "王师傅", role: "检验员", account: "wang_shifu" },
    { name: "赵师傅", role: "检验员", account: "zhao_shifu" },
    { name: "周丽", role: "仓库管理员", account: "zhou_li" },
    { name: "系统管理员", role: "超级管理员", account: "sys_admin" },
  ];
  systemEvents: SystemEvent[] = [
    { level: "高优先级", levelTone: "danger", module: "物料与 BOM", item: "订单引用的 BOM 版本信息缺失", ref: "ZM260830081", found: "09-04 16:20", state: "待核对", open: true },
    { level: "业务校验", levelTone: "warning", module: "成品出库", item: "超出可发库存的发货被拦截", ref: "ZM260903086", found: "09-05 10:12", state: "已拦截", open: true },
    { level: "配置变更", levelTone: "info", module: "系统管理", item: "检验员角色菜单权限变更", ref: "ROLE-INSPECTOR", found: "09-05 09:30", state: "已生效", open: true },
    { level: "提示", levelTone: "neutral", module: "客户档案", item: "疑似重复客户资料待合并", ref: "CUS-0906", found: "09-03 14:05", state: "待核对", open: false },
  ];
  opLog: OpLogEntry[] = [];
  version = 1;

  init() {
    this.boms = buildBoms();
    const orders = buildOrders(this.boms);
    this.customers = buildCustomers();

    // 共享库存：Σ 可发货订单种子库存（同 BOM 库存跨订单共享）
    orders.forEach((order) => {
      if (order.seedStock > 0) this.stock.set(order.bomCode, (this.stock.get(order.bomCode) || 0) + order.seedStock);
    });
    this.orders = orders.map(({ seedStock: _seedStock, ...order }) => order);

    this.outboundLedger = this.buildOutboundLedger();
    this.inboundLedger = this.buildInboundLedger();
    this.opLog = this.buildOpLog();
  }

  bomByCode(code: string) {
    return this.boms.find((bom) => bom.code === code);
  }

  stockOf(bomCode: string) {
    return Math.max(0, this.stock.get(bomCode) || 0);
  }

  orderStatusOf(order: Order): OrderStatus {
    if (order.outbound >= order.qty) return { label: "已完成", key: "done" };
    if (order.outbound > 0) return { label: "部分发货", key: "progress" };
    if (this.stockOf(order.bomCode) > 0) return { label: "可发货", key: "ready" };
    return { label: "待备货", key: "pending" };
  }

  remainingOf(order: Order) {
    return Math.max(0, order.qty - order.outbound);
  }

  private timeOf(seedIndex: number) {
    return `${String(8 + (seedIndex % 9)).padStart(2, "0")}:${String((seedIndex * 17) % 60).padStart(2, "0")}`;
  }

  private buildOutboundLedger(): OutboundRow[] {
    const raw: Array<Omit<OutboundRow, "no">> = [];
    const shipped = this.orders.filter((order) => order.outbound > 0);
    const recent = [...shipped]
      .sort((a, b) => a.deliverDate.localeCompare(b.deliverDate))
      .slice(-12)
      .map((order) => order.orderNo);
    const recentSet = new Set([...recent, "ZM260902084", "ZM260901083"]);
    const todayFirst = new Set(recent.slice(-6));

    shipped.forEach((order) => {
      const parts = order.qty > 2000 ? 2 : 1;
      const firstQty = parts === 2 ? Math.round(order.qty * (0.45 + rng() * 0.15)) : order.qty;
      let cursor = 0;
      [firstQty, order.qty - firstQty].slice(0, parts).forEach((qty, partIndex) => {
        cursor += 1;
        let date: string;
        if (recentSet.has(order.orderNo)) {
          date = partIndex === 0 && todayFirst.has(order.orderNo) ? ANCHOR : addDays(ANCHOR, -randInt(1, 6));
        } else {
          date = clampDate(addDays(order.deliverDate, -randInt(0, 3)), "2026-07-15", ANCHOR);
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
    return raw.map((row) => {
      const seq = (counter.get(row.date) || 18) + 1;
      counter.set(row.date, seq);
      return { ...row, no: `CK-${row.date.replaceAll("-", "")}-${String(seq).padStart(4, "0")}` };
    });
  }

  private buildInboundLedger(): InboundRow[] {
    const outByBom = new Map<string, number>();
    const firstOutByBom = new Map<string, OutboundRow>();
    this.outboundLedger.forEach((row) => {
      outByBom.set(row.bomCode, (outByBom.get(row.bomCode) || 0) + row.qty);
      const prev = firstOutByBom.get(row.bomCode);
      if (!prev || row.date < prev.date) firstOutByBom.set(row.bomCode, row);
    });

    const weekStart = addDays(ANCHOR, -6);
    const recentBoms = new Set(this.outboundLedger.filter((row) => row.date >= weekStart).map((row) => row.bomCode));
    const anchorBoms = new Set(
      this.outboundLedger.filter((row) => row.date === ANCHOR).map((row) => row.bomCode).slice(0, 3),
    );

    const raw: Array<Omit<InboundRow, "no">> = [];
    this.boms.forEach((bom) => {
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
        const qty = isLast ? totalIn - allocated : Math.max(100, Math.round((totalIn * weights[i]) / weightSum));
        allocated += qty;
        let date: string;
        if (isLast && anchorBoms.has(bom.code)) date = ANCHOR;
        else if (isLast && recentBoms.has(bom.code)) date = addDays(ANCHOR, -randInt(0, 6));
        else date = clampDate(addDays(baseDate, -randInt(1, 4) - i * randInt(2, 8)), "2026-07-10", ANCHOR);
        raw.push({
          bomCode: bom.code,
          qty,
          date,
          time: this.timeOf(raw.length * 5 + i),
          inspector: INSPECTORS[raw.length % INSPECTORS.length],
        });
      }
    });

    raw.sort((a, b) =>
      a.date === b.date ? a.bomCode.localeCompare(b.bomCode) : a.date.localeCompare(b.date),
    );
    const counter = new Map<string, number>();
    return raw.map((row) => {
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
      .filter((row) => row.date === ANCHOR)
      .forEach((row) =>
        push(ANCHOR, row.time, row.operator, row.operator === "周丽" ? "仓库管理员" : "检验员", "发货登记", row.no),
      );
    this.inboundLedger
      .filter((row) => row.date === ANCHOR)
      .forEach((row) => push(ANCHOR, row.time, row.inspector, "检验员", "成品入库", row.no));
    push(ANCHOR, "09:12", "李晓梅", "管理员", "新建销售订单", "ZM260903086");
    push(ANCHOR, "08:47", "李晓梅", "管理员", "新建客户档案", "CUS-0906");
    push(ANCHOR, "09:30", "系统管理员", "超级管理员", "权限变更", "ROLE-INSPECTOR");
    [1, 2, 3].forEach((offset) => {
      const day = addDays(ANCHOR, -offset);
      this.outboundLedger
        .filter((row) => row.date === day)
        .slice(0, 3)
        .forEach((row) =>
          push(day, row.time, row.operator, row.operator === "周丽" ? "仓库管理员" : "检验员", "发货登记", row.no),
        );
      this.inboundLedger
        .filter((row) => row.date === day)
        .slice(0, 2)
        .forEach((row) => push(day, row.time, row.inspector, "检验员", "成品入库", row.no));
    });
    return entries.sort((a, b) => (a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date)));
  }

  // ---- 变更操作 ----
  createOrder(input: {
    customerCode: string;
    customer: string;
    bomCode: string;
    qty: number;
    deliverStart: string;
    deliverEnd: string;
    orderDate: string;
    remark: string;
  }): Order {
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
      time: "10:24",
      user: "李晓梅",
      role: "管理员",
      action: "新建销售订单",
      target: orderNo,
    });
    this.version += 1;
    return order;
  }

  updateOrder(input: { orderNo: string; qty?: number; deliverDate?: string; remark?: string; reason?: string }): Order {
    const order = this.orders.find((item) => item.orderNo === input.orderNo);
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
        time: "11:20",
        user: "李晓梅",
        role: "管理员",
        action: "修改销售订单",
        target: `${order.orderNo}（${input.reason.trim()}）`,
      });
    }
    this.version += 1;
    return order;
  }

  createCustomer(input: { name: string; contact: string; phone: string; region: string; address: string; remark: string }): Customer {
    const maxSeq = this.customers.reduce((max, customer) => Math.max(max, Number(customer.code.slice(-4)) || 0), 0);
    const customer: Customer = {
      code: `CUS-${String(maxSeq + 1).padStart(4, "0")}`,
      name: input.name,
      contact: input.contact,
      phone: `${input.phone.slice(0, 3)}****${input.phone.slice(-4)}`,
      phoneFull: input.phone,
      region: input.region,
      city: input.region === "华东" ? "苏州" : input.region === "华南" ? "深圳" : input.region === "华北" ? "北京" : "成都",
      address: input.address,
      status: "待跟进",
      owner: "李晓梅",
      payTerms: "月结 30 天",
      created: ANCHOR,
    };
    this.customers.unshift(customer);
    this.opLog.unshift({ date: ANCHOR, time: "10:31", user: "李晓梅", role: "管理员", action: "新建客户档案", target: customer.code });
    this.version += 1;
    return customer;
  }

  createBom(input: { foot: string; model: string; contactFace: string; gearSpec: string; thickness: string; spring: string }): Bom {
    const maxSeq = this.boms.reduce((max, bom) => Math.max(max, Number(bom.code.slice(2)) || 0), 0);
    const row = {
      code: `ZM${String(maxSeq + 1).padStart(3, "0")}`,
      modelCode: input.contactFace,
      seriesLabel: input.foot,
      gear: input.gearSpec,
      gearSpec: "",
      gearDir: "",
      thickness: input.thickness,
      spring: input.spring,
      created: ANCHOR,
      name: "旋转开关",
      model: input.model,
      unit: "个",
    };
    const bom: Bom = { ...row, spec: specOf(row) };
    this.boms.unshift(bom);
    this.version += 1;
    return bom;
  }

  createInbound(input: { bomCode: string; qty: number; date: string; inspector: string; remark: string }): InboundRow {
    const bom = this.bomByCode(input.bomCode);
    if (!bom) throw new Error("成品不存在");
    if (!Number.isSafeInteger(input.qty) || input.qty <= 0) throw new Error("请输入有效的入库数量");
    if (!input.date) throw new Error("请选择入库日期");
    const rows = this.inboundLedger.filter((row) => row.date === input.date);
    const seq = rows.length > 0 ? Math.max(...rows.map((row) => Number(row.no.slice(-4)))) + 1 : 25;
    const row: InboundRow = {
      no: `RK-${input.date.replaceAll("-", "")}-${String(seq).padStart(4, "0")}`,
      bomCode: input.bomCode,
      qty: input.qty,
      date: input.date,
      time: "10:40",
      inspector: input.inspector,
      remark: input.remark,
    };
    this.inboundLedger.push(row);
    this.stock.set(input.bomCode, (this.stock.get(input.bomCode) || 0) + input.qty);
    this.opLog.unshift({ date: ANCHOR, time: row.time, user: input.inspector, role: "检验员", action: "成品入库", target: row.no });
    this.version += 1;
    return row;
  }

  createOutbound(input: { orderNo: string; qty: number; date: string; operator: string; remark: string }): OutboundRow {
    const order = this.orders.find((item) => item.orderNo === input.orderNo);
    if (!order) throw new Error("订单不存在");
    if (!Number.isSafeInteger(input.qty) || input.qty <= 0) throw new Error("请输入有效的发货数量");
    if (!input.date) throw new Error("请选择出库日期");
    if (input.qty > maxShipOf(order.orderNo)) throw new Error("可发库存已变化，请重新核对数量");
    const orderRows = this.outboundLedger.filter((row) => row.date === input.date);
    const seq = orderRows.length > 0 ? Math.max(...orderRows.map((row) => Number(row.no.slice(-4)))) + 1 : 19;
    const row: OutboundRow = {
      no: `CK-${input.date.replaceAll("-", "")}-${String(seq).padStart(4, "0")}`,
      orderNo: order.orderNo,
      customer: order.customer,
      customerCode: order.customerCode,
      bomCode: order.bomCode,
      qty: input.qty,
      date: input.date,
      time: "11:05",
      operator: input.operator,
      remark: input.remark,
    };
    this.outboundLedger.push(row);
    order.outbound = Math.min(order.qty, order.outbound + input.qty);
    this.stock.set(order.bomCode, Math.max(0, (this.stock.get(order.bomCode) || 0) - input.qty));
    this.opLog.unshift({ date: ANCHOR, time: row.time, user: input.operator, role: "检验员", action: "发货登记", target: row.no });
    this.version += 1;
    return row;
  }

  snapshot(): Snapshot {
    return {
      version: this.version,
      orders: this.orders.map((order) => ({ ...order })),
      boms: this.boms.map((bom) => ({ ...bom })),
      customers: this.customers.map((customer) => ({ ...customer })),
      inboundLedger: this.inboundLedger.map((row) => ({ ...row })),
      outboundLedger: this.outboundLedger.map((row) => ({ ...row })),
      stock: Object.fromEntries(this.stock),
    };
  }
}

export const store = new WbStore();
store.init();

// ---- 派生视图（纯函数，基于 store 当前状态） ----
const unfinished = () => store.orders.filter((order) => store.remainingOf(order) > 0);

export function statusCounts() {
  const counts = { total: store.orders.length, done: 0, progress: 0, ready: 0, pending: 0 };
  store.orders.forEach((order) => {
    counts[store.orderStatusOf(order).key] += 1;
  });
  return counts;
}

export function readyToShip(): ReadyToShipRow[] {
  const left = new Map(store.stock);
  return unfinished()
    .sort((a, b) => a.deliverDate.localeCompare(b.deliverDate) || a.orderNo.localeCompare(b.orderNo))
    .map((order) => {
      const available = left.get(order.bomCode) || 0;
      const remaining = store.remainingOf(order);
      const maxShip = Math.max(0, Math.min(remaining, available));
      if (maxShip > 0) left.set(order.bomCode, available - maxShip);
      const bom = store.bomByCode(order.bomCode);
      return {
        orderNo: order.orderNo,
        customer: order.customer,
        customerCode: order.customerCode,
        bomCode: order.bomCode,
        bomLabel: bom?.spec || "",
        deliverDate: order.deliverDate,
        remaining,
        stock: store.stockOf(order.bomCode),
        maxShip,
        status: store.orderStatusOf(order),
        overdue: order.deliverDate < ANCHOR,
      };
    });
}

const readyRows = () => readyToShip();

export function maxShipOf(orderNo: string) {
  return readyRows().find((row) => row.orderNo === orderNo)?.maxShip ?? 0;
}

export function pendingVsStock(limit: number): PendingVsStockRow[] {
  return readyRows()
    .sort((a, b) => a.deliverDate.localeCompare(b.deliverDate) || b.remaining - a.remaining)
    .slice(0, limit)
    .map((row) => {
      const order = store.orders.find((item) => item.orderNo === row.orderNo)!;
      return {
        id: row.orderNo,
        customer: row.customer,
        bomCode: row.bomCode,
        bomLabel: row.bomLabel,
        productType: "通用产品",
        version: "V1.0",
        deliverDate: row.deliverDate.slice(5).replace("-", "/"),
        ordered: order.qty,
        shipped: order.outbound,
        remaining: row.remaining,
        stock: row.stock,
        maxShip: row.maxShip,
        overdue: row.overdue,
      };
    });
}

export function riskOrders(limit?: number): RiskOrderRow[] {
  const rows = readyRows()
    .filter((row) => row.maxShip < row.remaining && row.deliverDate <= addDays(ANCHOR, 14))
    .sort((a, b) => a.deliverDate.localeCompare(b.deliverDate))
    .map((row) => {
      const order = store.orders.find((item) => item.orderNo === row.orderNo)!;
      return {
        orderNo: row.orderNo,
        customer: row.customer,
        customerCode: row.customerCode,
        bomCode: row.bomCode,
        bomLabel: row.bomLabel,
        deliverDate: row.deliverDate,
        qty: order.qty,
        outbound: order.outbound,
        remaining: row.remaining,
        stock: row.stock,
        maxShip: row.maxShip,
        overdue: row.deliverDate < ANCHOR,
      };
    });
  return limit ? rows.slice(0, limit) : rows;
}

export function stockGapBoms() {
  const demand = new Map<string, number>();
  unfinished().forEach((order) => {
    demand.set(order.bomCode, (demand.get(order.bomCode) || 0) + store.remainingOf(order));
  });
  let gap = 0;
  demand.forEach((need, bomCode) => {
    if (need > store.stockOf(bomCode)) gap += 1;
  });
  return gap;
}

export function stockGapList(): StockGapRow[] {
  const list: StockGapRow[] = [];
  const byBom = new Map<string, Order[]>();
  unfinished().forEach((order) => {
    if (!byBom.has(order.bomCode)) byBom.set(order.bomCode, []);
    byBom.get(order.bomCode)!.push(order);
  });
  byBom.forEach((orders, bomCode) => {
    const stockQty = store.stockOf(bomCode);
    const demandQty = orders.reduce((sum, order) => sum + store.remainingOf(order), 0);
    if (demandQty <= stockQty) return;
    const sorted = [...orders].sort((a, b) => a.deliverDate.localeCompare(b.deliverDate));
    const earliest = sorted[0];
    list.push({
      bomCode,
      gapQty: demandQty - stockQty,
      demandQty,
      stockQty,
      orderCount: orders.length,
      earliestDate: earliest.deliverDate,
      earliestOrderNo: earliest.orderNo,
      earliestCustomer: earliest.customer,
      earliestOverdue: earliest.deliverDate < ANCHOR,
    });
  });
  return list.sort((a, b) => a.earliestDate.localeCompare(b.earliestDate));
}

export function dailyTrend(days: number): TrendRow[] {
  const buckets: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) buckets.push(addDays(ANCHOR, -offset));
  const result: TrendRow[] = buckets.map((date) => ({
    date,
    label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
    orderedQty: 0,
    orderedCount: 0,
    inboundQty: 0,
    inboundCount: 0,
    outboundQty: 0,
    outboundCount: 0,
  }));
  const index = new Map(result.map((row) => [row.date, row]));
  store.orders.forEach((order) => {
    const row = index.get(order.orderDate);
    if (row) {
      row.orderedQty += order.qty;
      row.orderedCount += 1;
    }
  });
  store.inboundLedger.forEach((row) => {
    const bucket = index.get(row.date);
    if (bucket) {
      bucket.inboundQty += row.qty;
      bucket.inboundCount += 1;
    }
  });
  store.outboundLedger.forEach((row) => {
    const bucket = index.get(row.date);
    if (bucket) {
      bucket.outboundQty += row.qty;
      bucket.outboundCount += 1;
    }
  });
  return result;
}

export function topCustomers(limit?: number): TopCustomerRow[] {
  const byCustomer = new Map<string, TopCustomerRow>();
  store.orders.forEach((order) => {
    const entry =
      byCustomer.get(order.customerCode) ||
      {
        customer: order.customer,
        customerCode: order.customerCode,
        orderCount: 0,
        totalQty: 0,
        outboundQty: 0,
        pendingQty: 0,
      };
    entry.orderCount += 1;
    entry.totalQty += order.qty;
    entry.outboundQty += order.outbound;
    entry.pendingQty += store.remainingOf(order);
    byCustomer.set(order.customerCode, entry);
  });
  const rows = [...byCustomer.values()].sort((a, b) => b.totalQty - a.totalQty);
  return limit ? rows.slice(0, limit) : rows;
}

export function recentInbound(limit?: number): Array<InboundRow & { bomLabel: string }> {
  const rows = [...store.inboundLedger]
    .sort((a, b) => (a.date === b.date ? b.no.localeCompare(a.no) : b.date.localeCompare(a.date)))
    .map((row) => ({ ...row, bomLabel: store.bomByCode(row.bomCode)?.spec || "" }));
  return limit ? rows.slice(0, limit) : rows;
}

export function recentOutbound(limit?: number): OutboundRow[] {
  const rows = [...store.outboundLedger].sort((a, b) =>
    a.date === b.date ? b.no.localeCompare(a.no) : b.date.localeCompare(a.date),
  );
  return limit ? rows.slice(0, limit) : rows;
}
