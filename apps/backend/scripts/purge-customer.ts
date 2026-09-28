/**
 * 一次性清理：按客户编码删除测试客户及其全部关联痕迹（生产测试数据误入历史时用）。
 *
 * 清理范围（按 FK 依赖序，单事务执行）：
 *   outbound_state_log → outbound_ledger → outbound_shipment（该客户订单的出库）
 *   → sales_order_change_log → sales_order_table（订单）→ customer_owner_history
 *   → custom_table（客户行）→ op_log（客户编码 / 其订单号 / 其出库单号相关行）。
 * 不触碰：inbound_ledger（入库与客户无关）、biz_sequence（号段不回退防重号）、
 *   api_idempotency（操作性记录自然过期）。
 *
 * 安全：默认 dry-run 只打印清单；两种模式都会先把全部待删行导出到
 *   scripts/backups/purge-<code>-<ts>.json 留档；--apply 单事务执行，失败整体回滚。
 *
 * 用法：
 *   tsx scripts/purge-customer.ts --code CUS-0022           # 预览 + 留档
 *   tsx scripts/purge-customer.ts --code CUS-0022 --apply   # 执行
 */
import { config } from "dotenv";
import "../src/process-tz";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";

// env 统一在仓库根 .env（相对本包 cwd 解析）；包内 .env 兜底（容器/独立部署）
config({ path: ["../../.env", ".env"] });
import { createMariadbPool } from "../src/prisma/create-pool";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");

async function main(): Promise<void> {
    const codeIndex = process.argv.indexOf("--code");
    const code = codeIndex >= 0 ? (process.argv[codeIndex + 1] ?? "") : "";
    if (!/^[A-Za-z0-9_-]+$/.test(code)) {
        throw new Error("缺少合法的 --code 参数（如 --code CUS-0022）");
    }
    const apply = process.argv.includes("--apply");
    const host = process.env.DB_HOST ?? "localhost";
    const database = process.env.DB_DATABASE ?? "zmdb";
    console.log(
        `目标库 ${database}@${host}:${process.env.DB_PORT ?? "3306"}（模式：${apply ? "APPLY 执行删除" : "DRY-RUN 仅预览"}）`,
    );

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
        const customer = await prisma.customTable.findUnique({ where: { customerCode: code } });
        if (customer === null) {
            console.log(`客户 ${code} 不存在，无需清理。`);
            return;
        }
        // 走裸 SQL 读取：绕开生命周期枚举的演进差异（共享库可能存在客户端枚举没有的新值，P2023）
        const orders = await prisma.$queryRaw<
            Array<{ id: bigint; order_no: string; qty: number; lifecycle_status: string; created_at: Date }>
        >`
                SELECT id, order_no, qty, lifecycle_status, created_at
                FROM sales_order_table WHERE customer_id = ${customer.id} ORDER BY order_no`;
        const orderIds = orders.map(order => order.id);
        const orderNos = orders.map(order => order.order_no);
        const shipments =
            orderIds.length > 0 ? await prisma.outboundShipment.findMany({ where: { orderId: { in: orderIds } } }) : [];
        const shipmentIds = shipments.map(shipment => shipment.id);
        const shipmentNos = shipments.map(shipment => shipment.shipmentNo);
        const changeLogs =
            orderIds.length > 0
                ? await prisma.salesOrderChangeLog.findMany({ where: { orderId: { in: orderIds } } })
                : [];
        const ownerHistory = await prisma.customerOwnerHistory.findMany({ where: { customerId: customer.id } });
        const outboundLedger =
            shipmentIds.length > 0
                ? await prisma.outboundLedger.findMany({ where: { shipmentId: { in: shipmentIds } } })
                : [];
        const outboundStateLogs =
            shipmentIds.length > 0
                ? await prisma.outboundStateLog.findMany({ where: { shipmentId: { in: shipmentIds } } })
                : [];
        const opLogs = await prisma.opLog.findMany({
            where: {
                OR: [
                    { targetCode: code },
                    ...(orderNos.length > 0 ? [{ targetCode: { in: orderNos } }] : []),
                    ...(shipmentNos.length > 0 ? [{ targetCode: { in: shipmentNos } }] : []),
                ],
            },
            orderBy: { createdAt: "asc" },
        });

        // 留档先行：dry-run 与 apply 都导出，保证动手前已有完整快照
        const now = new Date();
        const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 15);
        const backupsDir = join(repoRoot, "scripts", "backups");
        mkdirSync(backupsDir, { recursive: true });
        const backupPath = join(backupsDir, `purge-${code}-${stamp}.json`);
        writeFileSync(
            backupPath,
            JSON.stringify(
                {
                    database,
                    exportedAt: now.toISOString(),
                    customer,
                    orders,
                    salesOrderChangeLog: changeLogs,
                    outboundShipments: shipments,
                    outboundLedger,
                    outboundStateLogs,
                    customerOwnerHistory: ownerHistory,
                    opLogs,
                },
                (_, value) => (typeof value === "bigint" ? value.toString() : value),
                2,
            ),
        );
        console.log(`待删行已留档 → ${backupPath}\n`);

        console.log(`客户：${code} ${customer.name}`);
        console.log(`  订单 ${orders.length}（${orderNos.join(", ") || "无"}）`);
        console.log(
            `  订单变更日志 ${changeLogs.length}；出库单 ${shipments.length}；出库台账 ${outboundLedger.length}；出库状态日志 ${outboundStateLogs.length}`,
        );
        console.log(`  负责人变更历史 ${ownerHistory.length}；相关 op_log ${opLogs.length}`);
        if (!apply) {
            console.log("\n预览模式结束；确认后加 --apply 执行。");
            return;
        }

        await prisma.$transaction([
            ...(shipmentIds.length > 0
                ? [prisma.outboundStateLog.deleteMany({ where: { shipmentId: { in: shipmentIds } } })]
                : []),
            ...(shipmentIds.length > 0
                ? [prisma.outboundLedger.deleteMany({ where: { shipmentId: { in: shipmentIds } } })]
                : []),
            ...(orderIds.length > 0
                ? [prisma.outboundShipment.deleteMany({ where: { orderId: { in: orderIds } } })]
                : []),
            ...(orderIds.length > 0
                ? [prisma.salesOrderChangeLog.deleteMany({ where: { orderId: { in: orderIds } } })]
                : []),
            prisma.customerOwnerHistory.deleteMany({ where: { customerId: customer.id } }),
            ...(orderIds.length > 0 ? [prisma.salesOrderTable.deleteMany({ where: { customerId: customer.id } })] : []),
            prisma.customTable.delete({ where: { id: customer.id } }),
            prisma.opLog.deleteMany({
                where: {
                    OR: [
                        { targetCode: code },
                        ...(orderNos.length > 0 ? [{ targetCode: { in: orderNos } }] : []),
                        ...(shipmentNos.length > 0 ? [{ targetCode: { in: shipmentNos } }] : []),
                    ],
                },
            }),
        ]);
        console.log(
            `已清理：订单 ${orders.length}、变更日志 ${changeLogs.length}、出库单 ${shipments.length}、` +
                `台账 ${outboundLedger.length}、状态日志 ${outboundStateLogs.length}、op_log ${opLogs.length}、客户 1。`,
        );
    } finally {
        await prisma.$disconnect();
        await pool.end().catch(() => undefined);
    }
}

void main();
