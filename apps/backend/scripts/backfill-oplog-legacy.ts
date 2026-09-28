/**
 * 一次性数据订正：回填旧格式 op_log 审计快照（2ea4caa 之前的遗留行）。
 *
 * 背景：system-logs 功能（2ea4caa）统一了 op_log.detail 的快照结构，但当时未回填
 * 存量，旧行在新日志页信息缺失。本脚本只回填当前库中可 100% 确证的来源：
 *  - create_order：customer ← custom_table.customer_code → name；deliverDate / remark
 *    ← sales_order_change_log 的 CREATE 行 after_json（与 op_log 同事务写入的创建时刻
 *    快照；当前订单行的 remark 可能被归档流程清空，不可作为来源）。已物理删除的订单
 *    （change_log 已随删清除）只补 customer——交期/备注无从确证，绝不编造。
 *  - ship：customer ← 订单号 → sales_order_table.customer_name_snapshot（随客户改名
 *    同步的订单级快照）；订单已删除的行不可确证，跳过。
 *
 * 幂等：仅处理 detail 中缺对应键的行，重跑安全。默认 dry-run 只打印计划；
 * 确认后加 --apply 执行。生产执行前务必先做全量备份。
 *
 * 用法：
 *   tsx scripts/backfill-oplog-legacy.ts          # 预览
 *   tsx scripts/backfill-oplog-legacy.ts --apply  # 执行
 */
import { config } from "dotenv";
import "../src/process-tz";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";

// env 统一在仓库根 .env（相对本包 cwd 解析）；包内 .env 兜底（容器/独立部署）
config({ path: ["../../.env", ".env"] });
import { createMariadbPool } from "../src/prisma/create-pool";

type JsonRecord = Record<string, unknown>;
interface BackfillPlan {
    id: bigint;
    code: string;
    detail: JsonRecord;
    note: string;
}

/** detail_json 宽松收窄：非对象（异常行）返回 null 并由调用方告警跳过 */
const asRecord = (value: unknown): JsonRecord | null =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;

const describePlan = (apply: boolean, plan: BackfillPlan, keys: string[]): string => {
    const fields = keys
        .map(key => {
            const value = plan.detail[key];
            return `+${key}=${JSON.stringify(value ?? null)}`;
        })
        .join(" ");
    return `[${apply ? "写入" : "预览"}] ${plan.code}  ${fields}  [${plan.note}]`;
};

/** 通道一：create_order 补 customer / deliverDate / remark */
async function planCreateOrder(
    prisma: PrismaClient,
    apply: boolean,
): Promise<{ plans: BackfillPlan[]; pending: number }> {
    const logs = await prisma.opLog.findMany({
        where: { action: "create_order" },
        orderBy: { createdAt: "asc" },
    });
    // 旧格式判定：detail 缺 $.customer（新格式行天然幂等跳过）
    const legacy = logs.filter(row => {
        const detail = asRecord(row.detailJson);
        return detail !== null && !("customer" in detail);
    });
    const plans: BackfillPlan[] = [];
    for (const row of legacy) {
        const detail = asRecord(row.detailJson);
        if (detail === null) {
            console.log(`[跳过] ${row.targetCode} detail_json 不是对象，请人工检查`);
            continue;
        }
        const customerCode = typeof detail.customerCode === "string" ? detail.customerCode : null;
        if (customerCode === null) {
            console.log(`[跳过] ${row.targetCode} detail 缺 customerCode，请人工检查`);
            continue;
        }
        const customer = await prisma.customTable.findUnique({ where: { customerCode } });
        if (customer === null) {
            console.log(`[跳过] ${row.targetCode} 客户 ${customerCode} 在客户表中不存在，请人工检查`);
            continue;
        }
        // 创建时刻快照：CREATE 行与 op_log 同事务写入；订单被物理删除后该行随删清除
        const createRow = await prisma.salesOrderChangeLog.findFirst({
            where: { orderId: row.targetId, eventType: "CREATE" },
        });
        const after = createRow === null ? null : asRecord(createRow.afterJson);
        const patched: JsonRecord = { ...detail, customer: customer.name };
        if (after !== null && "deliverDate" in after) patched.deliverDate = after.deliverDate;
        if (after !== null && "remark" in after) patched.remark = after.remark;
        const plan: BackfillPlan = {
            id: row.id,
            code: row.targetCode,
            detail: patched,
            note:
                after === null
                    ? "订单已删除，交期/备注不可知，仅补客户名"
                    : `来源: CREATE行@${createRow.createdAt.toISOString().slice(0, 10)}`,
        };
        console.log(describePlan(apply, plan, ["customer", ...(after !== null ? ["deliverDate", "remark"] : [])]));
        plans.push(plan);
    }
    return { plans, pending: legacy.length - plans.length };
}

/** 通道二：ship 补 customer（订单号 → 订单行上的客户名快照） */
async function planShipCustomer(
    prisma: PrismaClient,
    apply: boolean,
): Promise<{ plans: BackfillPlan[]; pending: number }> {
    const logs = await prisma.opLog.findMany({
        where: { action: "ship" },
        orderBy: { createdAt: "asc" },
    });
    const legacy = logs.filter(row => {
        const detail = asRecord(row.detailJson);
        return detail !== null && !("customer" in detail);
    });
    const plans: BackfillPlan[] = [];
    for (const row of legacy) {
        const detail = asRecord(row.detailJson);
        if (detail === null) {
            console.log(`[跳过] ${row.targetCode} detail_json 不是对象，请人工检查`);
            continue;
        }
        const orderNo = typeof detail.orderNo === "string" ? detail.orderNo : null;
        if (orderNo === null) {
            console.log(`[跳过] ${row.targetCode} detail 缺 orderNo，请人工检查`);
            continue;
        }
        // 走裸 SQL 读取：绕开生命周期枚举的演进差异（共享库可能存在客户端枚举没有的新值，P2023）
        const orderRows = await prisma.$queryRaw<Array<{ customer_name_snapshot: string }>>`
            SELECT customer_name_snapshot FROM sales_order_table WHERE order_no = ${orderNo}`;
        const customerName = orderRows[0]?.customer_name_snapshot ?? null;
        if (customerName === null || customerName === undefined) {
            console.log(`[跳过] ${row.targetCode} 订单 ${orderNo} 已删除，客户名不可知，不补`);
            continue;
        }
        const plan: BackfillPlan = {
            id: row.id,
            code: row.targetCode,
            detail: { ...detail, customer: customerName },
            note: `来源: 订单行快照（${orderNo}）`,
        };
        console.log(describePlan(apply, plan, ["customer"]));
        plans.push(plan);
    }
    return { plans, pending: legacy.length - plans.length };
}

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const host = process.env.DB_HOST ?? "localhost";
    const database = process.env.DB_DATABASE ?? "zmdb";
    console.log(
        `目标库 ${database}@${host}:${process.env.DB_PORT ?? "3306"}（模式：${apply ? "APPLY 执行写入" : "DRY-RUN 仅预览"}）`,
    );
    if (!apply) console.log("预览模式不写库；确认计划后加 --apply 执行。生产执行前先做全量备份。\n");

    const pool = createMariadbPool({
        host,
        port: Number.parseInt(process.env.DB_PORT ?? "3306", 10) || 3306,
        user: process.env.DB_USERNAME ?? "root",
        password: process.env.DB_PASSWORD ?? "",
        name: database,
        connectionLimit: 2,
    });
    const prisma = new PrismaClient({ adapter: new PrismaMariaDb(pool) });

    try {
        console.log("── 通道一：create_order ──");
        const createOrder = await planCreateOrder(prisma, apply);
        console.log(`\n── 通道二：ship ──`);
        const ship = await planShipCustomer(prisma, apply);

        const plans = [...createOrder.plans, ...ship.plans];
        const pending = createOrder.pending + ship.pending;
        console.log(`\n共 ${plans.length} 行待回填（另 ${pending} 行需人工检查）。`);
        if (plans.length === 0) {
            console.log("没有待回填的遗留行，无需订正。");
            return;
        }
        if (!apply) {
            console.log("预览模式结束；确认计划后加 --apply 执行。");
            return;
        }
        await prisma.$transaction(
            plans.map(plan => prisma.opLog.update({ where: { id: plan.id }, data: { detailJson: plan.detail } })),
        );
        console.log(`已回填 ${plans.length} 行。`);
    } finally {
        await prisma.$disconnect();
        await pool.end().catch(() => undefined);
    }
}

void main();
