/* 工作台演示数据（自前端 mocks/data/workbench.ts 移植）：
 * 按当天生成，订单、客户、出入库与结存使用同一组明细。 */

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
}

export interface WorkbenchMovement {
    date: string;
    bomCode: string;
    inbound: number;
    outbound: number;
}

/** 与前端 WorkbenchData 同构：数量必须使用同一种计量单位 */
export interface WorkbenchData {
    asOf: string;
    unit: string;
    products: WorkbenchProduct[];
    orders: WorkbenchOrder[];
    movements: WorkbenchMovement[];
}

/** ISO 日期（yyyy-MM-dd）加减天数；纯字符串运算，按 UTC 保持确定性 */
export const addDays = (isoDate: string, n: number): string => {
    const date = new Date(`${isoDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + n);
    return date.toISOString().slice(0, 10);
};

/** 业务口径的“今天”（北京时间 yyyy-MM-dd），与演示数据原前端生成逻辑一致 */
export const beijingToday = (): string =>
    new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());

const customerNames = [
    "浙江正泰电器有限公司",
    "宁波方太厨具有限公司",
    "杭州老板电器股份有限公司",
    "广东美的生活电器有限公司",
    "苏泊尔家电制造有限公司",
    "九阳生活电器有限公司",
    "中山华帝厨卫有限公司",
    "浙江德意厨具有限公司",
    "青岛海尔电器有限公司",
    "佛山万和电气有限公司",
    "广东格兰仕电器有限公司",
    "杭州松下家用电器有限公司",
    "宁波奥克斯电气有限公司",
    "浙江飞科电器有限公司",
    "中山欧普照明有限公司",
    "温州鸿远电子有限公司",
    "乐清宏达电器有限公司",
    "慈溪恒丰电器有限公司",
    "余姚嘉诚电子有限公司",
    "台州新源机电有限公司",
    "绍兴华盛电气有限公司",
    "金华永信电器有限公司",
    "嘉兴佳禾电子有限公司",
    "湖州明达机电有限公司",
];
/* 演示品类与系统一致：仅 旋转XK2 / 新微动 / 老微动（物料目录模式） */
const categories = [
    { name: "旋转XK2", prefix: "XK2", models: ["1-1", "2-1", "3-1"] },
    { name: "新微动", prefix: "KW0", models: ["", "", ""] },
    { name: "老微动", prefix: "KW16", models: ["", "", ""] },
];

export function createWorkbenchDemo(asOf: string): WorkbenchData {
    const products = categories.flatMap((category, categoryIndex) =>
        category.models.map((model, index) => ({
            code: `ZM${category.prefix}${String(index + 1).padStart(3, "0")}`,
            category: category.name,
            model,
            spec: [
                ["方向：正面 · 弹簧：0.5", "方向：反面 · 弹簧：0.55", "方向：正面 · A面：三脚银点"],
                [
                    "底座：二脚底座（无挡脚） · 支架：6.3支架：铜镀银",
                    "底座：三脚底座（有挡脚） · 静片：6.3静片：铜镀银",
                    "盖子：盖子 · 按钮：8.5mm · 弹片：0.12",
                ],
                ["底座：带CB · 按钮：8.5mm", "底座：不带CB · 按钮：8.9mm · 挡脚：挡脚", "底座：带CB · 弹簧：0.27"],
            ][categoryIndex][index],
            unit: "个",
            stock: [800, 1600, 400][index] + categoryIndex * 150,
        })),
    );
    const orders: WorkbenchOrder[] = Array.from({ length: 240 }, (_, index) => {
        const customerIndex = (index * 7 + Math.floor(index / 24)) % customerNames.length;
        const product = products[(index * 7 + Math.floor(index / 15)) % products.length];
        const age = 240 - index;
        const date = addDays(asOf, -age);
        const recent = age <= 24;
        // 近期大单按品类体现不同备货压力，避免各品类进度看起来完全相同。
        const scale = recent ? [7, 8, 5][categories.findIndex(category => category.name === product.category)] : 1;
        const qty = (8 + ((index * 13) % 24) + (24 - customerIndex)) * 100 * scale;
        const cancelled = index % 59 === 0;
        return {
            no: `SO-${date.replaceAll("-", "")}-${String(index + 1).padStart(3, "0")}`,
            customerCode: `C${String(customerIndex + 1).padStart(3, "0")}`,
            customer: customerNames[customerIndex],
            bomCode: product.code,
            date,
            due: addDays(date, recent ? 14 : 10),
            qty,
            shipped: cancelled
                ? index % 2 === 0
                    ? 0
                    : Math.floor(qty / 200) * 100
                : recent
                  ? Math.floor((qty * [0.2, 0.45, 0.7, 1][index % 4]) / 100) * 100
                  : qty,
            cancelled,
        };
    });
    // 每笔实际发货在此前一天有对应检验入库；额外入库构成当前结存。
    const movements = orders
        .filter(order => order.shipped > 0)
        .flatMap(order => {
            const plannedShipDate = addDays(order.date, 3);
            const shipDate = plannedShipDate < asOf ? plannedShipDate : asOf;
            return [
                { date: addDays(shipDate, -1), bomCode: order.bomCode, inbound: order.shipped, outbound: 0 },
                { date: shipDate, bomCode: order.bomCode, inbound: 0, outbound: order.shipped },
            ];
        });
    products.forEach((product, index) =>
        movements.push({
            date: addDays(asOf, -(index % 7)),
            bomCode: product.code,
            inbound: product.stock,
            outbound: 0,
        }),
    );
    return { asOf, unit: "个", products, orders, movements };
}
