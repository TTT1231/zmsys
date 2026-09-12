/* 工作台独立演示数据：按当天生成，订单、客户、出入库与结存使用同一组明细。 */
import type { WorkbenchData, WorkbenchOrder } from "../../src/data/workbench";
import { addDays } from "../../src/lib/date";

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
const categories = [
    { name: "旋转开关", prefix: "XK2", models: ["222-1", "232-2", "242-3"] },
    { name: "XK3", prefix: "XK3", models: ["XK3-101", "XK3-102", "XK3-103"] },
    { name: "新微动", prefix: "KW0", models: ["KW-01", "KW-02", "KW-03"] },
    { name: "老微动", prefix: "KW16", models: ["KW16-1", "KW16-2", "KW16-3"] },
    { name: "琴键开关", prefix: "KQ", models: ["KQ-4", "KQ-5", "KQ-6"] },
];

export function createWorkbenchDemo(asOf: string): WorkbenchData {
    const products = categories.flatMap((category, categoryIndex) =>
        category.models.map((model, index) => ({
            code: `ZM${category.prefix}${String(index + 1).padStart(3, "0")}`,
            category: category.name,
            model,
            spec: [
                ["二脚 · 两档 · 正面", "三脚 · 三档 · 正面", "四脚 · 四档 · 正面"],
                ["圆孔长外壳 · 圆轴长杆", "圆孔短外壳 · 圆轴短杆", "无耳外壳 · 扁轴4.8"],
                ["6.3支架 · 铜镀银", "4.8支架 · 铜镀镍", "6.3支架 · 复合铜镀镍"],
                ["长柄 · 铜镀银", "短柄 · 铜镀镍", "无柄 · 复合铜"],
                ["四键 · 标准款", "五键 · 标准款", "六键 · 定制款"],
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
        const scale = recent
            ? [7, 4, 8, 5, 2][categories.findIndex(category => category.name === product.category)]
            : 1;
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
