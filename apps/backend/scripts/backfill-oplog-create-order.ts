/**
 * 一次性数据订正：回填旧格式 create_order 审计快照（2ea4caa 之前的遗留行）。
 *
 * 背景：system-logs 功能（2ea4caa）把 create_order 的 op_log.detail 从最小格式
 * {qty, bomCode, customerCode} 升级为完整快照 + customer 名称，但当时未回填存量，
 * 旧行在新日志页缺少客户名/交货日期/备注。本脚本只回填当前库中可 100% 确证的来源：
 *  - customer    ← custom_table.customer_code → name（客户名当前值，审计上不可知改名史，
 *                  仅当确认无改名时视为创建时刻值）
 *  - deliverDate / remark ← sales_order_change_log 的 CREATE 行 after_json（与 op_log
 *                  同事务写入的创建时刻快照；注意当前订单行的 remark 可能被归档流程
 *                  清空，不可作为来源）
 * 已物理删除的订单（change_log 已随删清除）只补 customer——交期/备注无从确证，绝不编造。
 *
 * 幂等：仅处理 detail 中缺 $.customer 的行，重跑安全。默认 dry-run 只打印计划；
 * 确认后加 --apply 执行。生产执行前务必先做全量备份。
 *
 * 用法：
 *   tsx scripts/backfill-oplog-create-order.ts          # 预览
 *   tsx scripts/backfill-oplog-create-order.ts --apply  # 执行
 */
import { config } from "dotenv";
import "../src/process-tz";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";

// env 统一在仓库根 .env（相对本包 cwd 解析）；包内 .env 兜底（容器/独立部署）
config({ path: ["../../.env", ".env"] });
import { createMariadbPool } from "../src/prisma/create-pool";

type JsonRecord = Record<string, unknown>;

/** detail_json 宽松收窄：非对象（异常行）返回 null 并由调用方告警跳过 */
const asRecord = (value: unknown): JsonRecord | null =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const host = process.env.DB_HOST ?? "localhost";
    const database = process.env.DB_DATABASE ?? "zmdb";
    console.log(`目标库 ${database}@${host}（模式：${apply ? "APPLY 执行写入" : "DRY-RUN 仅预览"}）`);
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
        const logs = await prisma.opLog.findMany({
            where: { action: "create_order" },
            orderBy: { createdAt: "asc" },
        });
        // 旧格式判定：detail 缺 $.customer（新格式行天然幂等跳过）
        const legacy = logs.filter(row => {
            const detail = asRecord(row.detailJson);
            return detail !== null && !("customer" in detail);
        });
        if (legacy.length === 0) {
            console.log("没有发现待回填的旧格式 create_order 行，无需订正。");
            return;
        }

        const plans: Array<{ id: bigint; code: string; detail: JsonRecord; note: string }> = [];
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
            const note =
                after === null
                    ? "订单已删除，交期/备注不可知，仅补客户名"
                    : `来源: CREATE行@${createRow.createdAt.toISOString().slice(0, 10)}`;
            const fields = ["customer", ...(after !== null ? ["deliverDate", "remark"] : [])]
                .map(key => {
                    const value = patched[key];
                    return `+${key}=${JSON.stringify(value ?? null)}`;
                })
                .join(" ");
            console.log(
                `[${apply ? "写入" : "预览"}] ${row.targetCode}（${row.createdAt.toISOString().slice(0, 10)}） ${fields}  [${note}]`,
            );
            plans.push({ id: row.id, code: row.targetCode, detail: patched, note });
        }

        console.log(`\n共 ${plans.length} 行待回填（其余 ${legacy.length - plans.length} 行需人工检查）。`);
        if (!apply || plans.length === 0) return;

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
