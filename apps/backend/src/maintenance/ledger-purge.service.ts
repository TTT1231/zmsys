import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { TransactionRunner } from "../prisma/transaction.runner";
import type { Tx } from "../prisma/transaction.runner";
import { MaintenanceState } from "../domain/maintenance-state";

/** 软删除保留期（天）：过期后物理清理，op_log 的 delete 快照成为唯一残留 */
const SOFT_DELETE_RETENTION_DAYS = 7;
/** 清理调度间隔：每日一次 */
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** 启动后延迟首跑：避开应用预热，补偿停机错过的清理 */
const FIRST_RUN_DELAY_MS = 30 * 1000;
/** 每批处理行数：限制事务长度与锁持有时间 */
const BATCH_SIZE = 500;

/**
 * 台账软删除物理清理（db-scheme.md §7.1）：删除 deleted_at 超过保留期的已作废
 * 入库/出库单及连带子行（变更日志/状态日志/数量流水）。审计口径：删除动作本身
 * 已在 op_log 留全量快照（含作废原因），本任务是系统自动行为、不写 op_log；
 * 被清理单据的完整修正轨迹（UPDATE 历史）随之消失，属既定取舍。
 * 入库候选直接排除仍被库存调整单引用的行（NOT EXISTS）——源头已禁止新调整单
 * 关联已删除单，此处为存量脏数据的防御兜底，同时避免"整批全是跳过行"造成的
 * 批次空转；每批删除即提交（进度自然推进），查空即退出。
 */
@Injectable()
export class LedgerPurgeService implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly logger = new Logger(LedgerPurgeService.name);
    private intervalHandle: NodeJS.Timeout | null = null;
    private firstRunHandle: NodeJS.Timeout | null = null;

    constructor(
        private readonly prisma: PrismaService,
        private readonly txRunner: TransactionRunner,
        private readonly maintenance: MaintenanceState,
    ) {}

    onApplicationBootstrap(): void {
        if (process.env.NODE_ENV === "test") {
            return;
        }
        this.firstRunHandle = setTimeout(() => {
            this.firstRunHandle = null;
            void this.runScheduledPurge();
        }, FIRST_RUN_DELAY_MS);
        this.intervalHandle = setInterval(() => void this.runScheduledPurge(), PURGE_INTERVAL_MS);
    }

    onApplicationShutdown(): void {
        if (this.firstRunHandle !== null) {
            clearTimeout(this.firstRunHandle);
            this.firstRunHandle = null;
        }
        if (this.intervalHandle !== null) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }

    /** 定时入口：按保留期计算截止时刻；调度错误记录后不中断后续调度 */
    private async runScheduledPurge(): Promise<void> {
        // 恢复维护期间不启动新批次（实施计划 §4：另等 purgeActive=false）
        if (this.maintenance.isActive()) {
            return;
        }
        this.maintenance.purgeActive = true;
        const cutoff = new Date(Date.now() - SOFT_DELETE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        try {
            const counts = await this.purge(cutoff);
            if (counts.inbound > 0 || counts.outbound > 0 || counts.orders > 0) {
                this.logger.log(
                    `台账清理完成：入库 ${counts.inbound} 条、出库 ${counts.outbound} 条、订单 ${counts.orders} 条`,
                );
            }
        } catch (error) {
            this.logger.error(`台账清理失败，将于下个调度周期重试: ${String(error)}`);
        } finally {
            this.maintenance.purgeActive = false;
        }
    }

    /**
     * 物理清理 deleted_at 早于截止时刻（cutoff）的已删单；cutoff 可注入，
     * 测试/真库验证传未来时刻即全部到期。返回各自清理的行数。
     */
    async purge(cutoff: Date): Promise<{ inbound: number; outbound: number; orders: number }> {
        const inbound = await this.purgeInbound(cutoff);
        const outbound = await this.purgeOutbound(cutoff);
        const orders = await this.purgeOrders(cutoff);
        return { inbound, outbound, orders };
    }

    private async purgeInbound(cutoff: Date): Promise<number> {
        let purged = 0;
        for (;;) {
            const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>(
                Prisma.sql`SELECT id FROM inbound_ledger
                    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
                      AND NOT EXISTS (
                          SELECT 1 FROM stock_adjustment WHERE related_inbound_id = inbound_ledger.id
                      )
                    ORDER BY id ASC LIMIT ${BATCH_SIZE}`,
            );
            if (rows.length === 0) {
                return purged;
            }
            const batch = rows.map(row => row.id);
            await this.txRunner.run(async (tx: Tx) => {
                await tx.inboundChangeLog.deleteMany({ where: { inboundId: { in: batch } } });
                await tx.inboundLedger.deleteMany({ where: { id: { in: batch } } });
            });
            purged += batch.length;
        }
    }

    private async purgeOutbound(cutoff: Date): Promise<number> {
        let purged = 0;
        for (;;) {
            const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>(
                Prisma.sql`SELECT id FROM outbound_shipment
                    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
                    ORDER BY id ASC LIMIT ${BATCH_SIZE}`,
            );
            if (rows.length === 0) {
                return purged;
            }
            const batch = rows.map(row => row.id);
            await this.txRunner.run(async (tx: Tx) => {
                await tx.outboundStateLog.deleteMany({ where: { shipmentId: { in: batch } } });
                // 先删 CORRECTION（子）再删 NORMAL（父）：correction_of_id 自引用外键顺序
                await tx.outboundLedger.deleteMany({
                    where: { shipmentId: { in: batch }, correctionOfId: { not: null } },
                });
                await tx.outboundLedger.deleteMany({ where: { shipmentId: { in: batch } } });
                await tx.outboundShipment.deleteMany({ where: { id: { in: batch } } });
            });
            purged += batch.length;
        }
    }

    /** 订单须先过保留期，且关联出库已物理清理；保留 op_log 删除快照。 */
    private async purgeOrders(cutoff: Date): Promise<number> {
        let purged = 0;
        for (;;) {
            const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>(
                Prisma.sql`SELECT id FROM sales_order_table
                    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
                      AND NOT EXISTS (
                          SELECT 1 FROM outbound_shipment WHERE order_id = sales_order_table.id
                      )
                    ORDER BY id ASC LIMIT ${BATCH_SIZE}`,
            );
            if (rows.length === 0) return purged;
            const batch = rows.map(row => row.id);
            await this.txRunner.run(async (tx: Tx) => {
                await tx.salesOrderChangeLog.deleteMany({ where: { orderId: { in: batch } } });
                await tx.salesOrderTable.deleteMany({ where: { id: { in: batch } } });
            });
            purged += batch.length;
        }
    }
}
