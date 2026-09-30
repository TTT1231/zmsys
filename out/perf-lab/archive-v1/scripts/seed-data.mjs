/* zmdb_test 业务数据准备：经真实后端 API 造 BOM / 客户 / 订单 / 入库 / 出库。
 *
 * 背景：pnpm test:db:reset 只播种账号与目录（apps/backend/prisma/seed.ts:17-19 仅
 * SEED_USERS；BOM 品类物料目录由迁移 SQL 播种），业务表为空——不造数则 8 个场景
 * 全部空转。策略：补足到固定目标（BOM>=60、客户>=3、订单>=40、入库/出库配套），
 * 已达标则跳过，保证同一份 reset 后多次 sweep 数据量稳定。 */
import { randomUUID } from "node:crypto";

const TARGET_BOMS = 60;
const TARGET_ORDERS = 40;

function todayPlus(days) {
    const d = new Date(Date.now() + days * 86400_000);
    return d.toISOString().slice(0, 10);
}

export class Api {
    constructor(base, token) {
        this.base = base;
        this.token = token;
    }
    async call(method, path, body) {
        const res = await fetch(`${this.base}/api${path}`, {
            method,
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${this.token}`,
                ...(body !== undefined ? { "idempotency-key": `perf-lab-${randomUUID()}` } : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(`API ${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
            err.status = res.status;
            throw err;
        }
        return json.data ?? json;
    }
    get(path) {
        return this.call("GET", path);
    }
    post(path, body) {
        return this.call("POST", path, body);
    }
}

/** 从品类目录收集「组」列表：每组 {multi, items}，构成 = 每组至多一项（单选组） */
function collectGroups(category) {
    const groups = [];
    const walk = nodes => {
        for (const node of nodes) {
            if (node.kind === "section") {
                walk(node.groups ?? []);
            } else if (node.kind === "group") {
                const items = node.items ?? [];
                if (items.length > 0) groups.push({ multi: !!node.multi, qty: !!node.qty, items });
            }
        }
    };
    walk(category.groups ?? []);
    return groups;
}

export async function seedBusinessData(api, log = () => {}) {
    const report = {
        bomsCreated: 0,
        customersCreated: 0,
        ordersCreated: 0,
        inboundCreated: 0,
        outboundCreated: 0,
        skipped: [],
    };

    const categories = await api.get("/bom-categories");
    const boms = await api.get("/boms");
    log(`existing boms=${boms.length}, categories=${categories.map(c => c.name).join("、")}`);

    // 只用无子品类要求的品类轮转（有 childCategories 的需二级选择，构成复杂且物料少）
    const simpleCategories = categories.filter(c => c.status !== false && !(c.childCategories?.length > 0));
    if (simpleCategories.length === 0) throw new Error("没有可用的无子品类 BOM 品类，无法造数");

    let created = 0;
    const groupsByCategory = new Map(simpleCategories.map(c => [c.name, collectGroups(c)]));
    for (let i = boms.length; i < TARGET_BOMS; i++) {
        const category = simpleCategories[i % simpleCategories.length];
        const groups = groupsByCategory.get(category.name);
        if (!groups || groups.length === 0) throw new Error(`品类 ${category.name} 目录无物料组`);
        // 构成：前 4 组各选一项（qty 组带数量），组内 item 按索引轮转保证构成多样；
        // 唯一 remark 避免「品类+构成+备注」判重 409
        const materialItemIds = [];
        const quantities = {};
        for (const [k, group] of groups.slice(0, 4).entries()) {
            materialItemIds.push(group.items[(i + k) % group.items.length].id);
            if (group.qty) quantities[materialItemIds.at(-1)] = 1 + ((i + k) % 3);
        }
        try {
            await api.post("/boms", {
                name: category.name,
                materialItemIds,
                ...(Object.keys(quantities).length > 0 ? { quantities } : {}),
                remark: `perf-lab #${i}`,
            });
            created++;
        } catch (err) {
            if (err.status === 409) continue; // 撞构成判重：换下一条
            throw err;
        }
    }
    report.bomsCreated = created;

    // 客户（orders 依赖）
    let customerCode = null;
    const customers = await api.get("/customers").catch(() => []);
    if (customers.length > 0) {
        customerCode = customers[0].code;
    } else {
        const created0 = [];
        for (let i = 0; i < 3; i++) {
            const c = await api.post("/customers", {
                name: `perf客户${i + 1}号`,
                contact: `联系人${i + 1}`,
                phone: `1380000000${i}`,
                province: "江苏省",
                city: "苏州市",
                district: "昆山市",
                town: "花桥镇",
                address: `测试路 ${i + 1} 号`,
                ownerAccount: "guojun",
                payTerms: "款到发货",
            });
            created0.push(c);
            report.customersCreated++;
        }
        customerCode = created0[0].code;
    }

    // 订单 + 配套入库（入库量 > 订单量，让「可发货」ready 筛选有数据）
    const allBoms = await api.get("/boms");
    const usable = allBoms.filter(bom => simpleCategories.some(c => c.name === bom.name));
    const pool = usable.length > 0 ? usable : allBoms;
    let ordersNow = await api.get("/orders");
    const inboundExisting = new Set((await api.get("/inbound")).map(r => r.bomCode));
    const ordersMade = [];
    for (let i = ordersNow.length; i < TARGET_ORDERS; i++) {
        const bom = pool[i % pool.length];
        const order = await api.post("/orders", {
            customerCode,
            bomCode: bom.code,
            qty: 1 + (i % 3),
            orderDate: todayPlus(-7 - (i % 5)),
            deliverDate: todayPlus(3 + (i % 10)),
            remark: `perf-lab order #${i}`,
        });
        ordersMade.push(order);
        report.ordersCreated++;
        // 每条订单配套入库 5 件（> qty，保证可发货）
        if (!inboundExisting.has(bom.code) || i % 4 === 0) {
            await api.post("/inbound", {
                bomCode: bom.code,
                qty: 5,
                date: todayPlus(-6 - (i % 3)),
                remark: `perf-lab inbound #${i}`,
            });
            inboundExisting.add(bom.code);
            report.inboundCreated++;
        }
    }

    // 出库：给最早两单各发 1 件（成品台账有数据，BOM 页 usage 引用完整）
    if (report.ordersCreated > 0) {
        for (const order of ordersMade.slice(0, 2)) {
            await api
                .post("/outbound", {
                    orderNo: order.orderNo,
                    qty: 1,
                    date: todayPlus(-1),
                    remark: "perf-lab outbound",
                })
                .catch(err => {
                    report.skipped.push(`outbound ${order.orderNo}: ${err.message}`);
                });
            report.outboundCreated++;
        }
    }

    const finalBoms = await api.get("/boms");
    const finalOrders = await api.get("/orders");
    report.summary = {
        boms: finalBoms.length,
        orders: finalOrders.length,
        customers: (await api.get("/customers")).length,
    };
    log(`seed done: ${JSON.stringify(report)}`);
    return report;
}
