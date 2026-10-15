import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { beijingDayWindow } from "../common/beijing-day";
import { formatDateColumn } from "../common/datetime";
import type { OpLogAction } from "../domain/op-log";
import type { AgentDeletedQueryDto } from "./dto/agent-deleted-query.dto";
import type { VoidedInboundQueryDto, VoidedOutboundQueryDto } from "./dto/agent-voided-query.dto";
import type {
    DeletedDomain,
    DeletedRecordItem,
    DeletedRecordPage,
    VoidedInboundItem,
    VoidedInboundPage,
    VoidedOutboundItem,
    VoidedOutboundPage,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** op_log 全部 delete_* 动作 → 业务域（对齐 system-logs.service 的映射口径） */
const DELETE_ACTION_DOMAIN: Partial<Record<OpLogAction, DeletedDomain>> = {
    delete_customer: "customer",
    delete_order: "order",
    delete_bom: "bom",
    delete_bom_category: "bom_structure",
    delete_inbound: "inbound",
    delete_outbound: "outbound",
};

/**
 * agent 只读查询（契约 /ai/agent/*）：作废单据薄查询与删除审计快照。
 * 全业务数据不走这里——工作台读模型与分析页关系聚合由 GET /workbench/overview、
 * GET /workbench/relations 提供（openapi 已声明 agent 共用），各域明细列表与
 * 系统日志（操作历史/谁改的/什么时候改的）亦直接复用既有端点；本服务只补
 * 「只看作废」与「查已删除」两个既有端点缺的视角。数据边界总纲：agent 能看到
 * 的 = 该用户本人在系统页面能看到的（各端点沿用既有权限码）。
 * 模块边界约定（module-boundary.spec）：不 import 其他业务模块内部文件，薄查询直接走 Prisma。
 */
@Injectable()
export class AiAgentService {
    constructor(private readonly prisma: PrismaService) {}

    /** 作废入库台账（含作废人/时间/原因；原因与作废人取最后一条 VOID 变更日志，
     *  与删除快照的 lastVoidReason 同源口径） */
    async listVoidedInbound(query: VoidedInboundQueryDto): Promise<VoidedInboundPage> {
        const where = {
            status: "VOIDED" as const,
            ...(query.bomCode ? { bom: { bomCode: query.bomCode } } : {}),
            ...(query.keyword
                ? {
                      OR: [{ entryNo: { contains: query.keyword } }, { bom: { bomCode: { contains: query.keyword } } }],
                  }
                : {}),
        };
        const [rows, total] = await this.prisma.$transaction([
            this.prisma.inboundLedger.findMany({
                where,
                orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
                take: query.limit,
                select: {
                    id: true,
                    entryNo: true,
                    qty: true,
                    businessDate: true,
                    remark: true,
                    updatedAt: true,
                    bom: { select: { bomCode: true, category: { select: { name: true } } } },
                },
            }),
            this.prisma.inboundLedger.count({ where }),
        ]);
        const voidLogs = rows.length
            ? await this.prisma.inboundChangeLog.findMany({
                  where: { inboundId: { in: rows.map(row => row.id) }, eventType: "VOID" },
                  orderBy: { createdAt: "asc" },
                  select: {
                      inboundId: true,
                      reason: true,
                      createdAt: true,
                      operator: { select: { name: true } },
                  },
              })
            : [];
        const lastVoidOf = new Map(voidLogs.map(log => [log.inboundId, log]));
        const items: VoidedInboundItem[] = rows.map(row => {
            const voidLog = lastVoidOf.get(row.id);
            return {
                id: row.id.toString(),
                entryNo: row.entryNo,
                bomCode: row.bom.bomCode,
                bomName: row.bom.category.name,
                qty: row.qty,
                businessDate: formatDateColumn(row.businessDate),
                remark: row.remark,
                status: "voided",
                voidedBy: voidLog?.operator.name ?? "",
                voidedAt: (voidLog?.createdAt ?? row.updatedAt).toISOString(),
                voidReason: voidLog?.reason ?? null,
            };
        });
        return { items, total };
    }

    /** 作废出库单（作废人/时间/原因在单头上；订单侧用下单时冻结的快照） */
    async listVoidedOutbound(query: VoidedOutboundQueryDto): Promise<VoidedOutboundPage> {
        const where = {
            state: "VOIDED" as const,
            ...(query.orderNo ? { order: { orderNo: query.orderNo } } : {}),
            ...(query.bomCode ? { order: { bom: { bomCode: query.bomCode } } } : {}),
            ...(query.keyword
                ? {
                      OR: [
                          { shipmentNo: { contains: query.keyword } },
                          { order: { orderNo: { contains: query.keyword } } },
                      ],
                  }
                : {}),
        };
        const [rows, total] = await this.prisma.$transaction([
            this.prisma.outboundShipment.findMany({
                where,
                orderBy: [{ voidedAt: "desc" }, { id: "desc" }],
                take: query.limit,
                select: {
                    id: true,
                    shipmentNo: true,
                    originalQty: true,
                    businessDate: true,
                    voidedAt: true,
                    voidReason: true,
                    voider: { select: { name: true } },
                    order: {
                        select: {
                            orderNo: true,
                            customerNameSnapshot: true,
                            bomNameSnapshot: true,
                            bom: { select: { bomCode: true } },
                        },
                    },
                },
            }),
            this.prisma.outboundShipment.count({ where }),
        ]);
        const items: VoidedOutboundItem[] = rows.map(row => ({
            id: row.id.toString(),
            shipmentNo: row.shipmentNo,
            orderNo: row.order.orderNo,
            customerName: row.order.customerNameSnapshot,
            bomCode: row.order.bom.bomCode,
            bomName: row.order.bomNameSnapshot,
            qty: row.originalQty,
            businessDate: formatDateColumn(row.businessDate),
            status: "voided",
            voidedBy: row.voider?.name ?? "",
            voidedAt: (row.voidedAt ?? row.businessDate).toISOString(),
            voidReason: row.voidReason,
        }));
        return { items, total };
    }

    /** 已删除数据：op_log delete_* 快照（物理删除后唯一留存；detail 为删除前全量快照） */
    async listDeleted(query: AgentDeletedQueryDto): Promise<DeletedRecordPage> {
        const window = this.timeWindow(query);
        const cursorAt = query.beforeAt !== undefined && query.beforeId !== undefined ? new Date(query.beforeAt) : null;
        if (cursorAt && Number.isNaN(cursorAt.getTime())) {
            throw new BadRequestException("beforeAt 须为合法 ISO 时刻");
        }
        const cursorId = query.beforeId !== undefined ? BigInt(query.beforeId) : null;
        const actions = query.domain
            ? (Object.keys(DELETE_ACTION_DOMAIN) as OpLogAction[]).filter(
                  action => DELETE_ACTION_DOMAIN[action] === query.domain,
              )
            : (Object.keys(DELETE_ACTION_DOMAIN) as OpLogAction[]);
        const rows = await this.prisma.opLog.findMany({
            where: {
                action: { in: actions },
                createdAt: { gte: window.start, lt: window.end },
                // 复合游标（严格小于，防重复/漏行）：createdAt < c OR (createdAt = c AND id < i)
                ...(cursorAt && cursorId !== null
                    ? {
                          OR: [
                              { createdAt: { lt: cursorAt } },
                              { AND: [{ createdAt: cursorAt }, { id: { lt: cursorId } }] },
                          ],
                      }
                    : {}),
                ...(query.keyword ? { targetCode: { contains: query.keyword } } : {}),
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: query.limit + 1,
        });
        const hasMore = rows.length > query.limit;
        const batch = hasMore ? rows.slice(0, query.limit) : rows;
        const last = batch.at(-1);
        const items: DeletedRecordItem[] = batch.map(row => ({
            id: row.id.toString(),
            occurredAt: row.createdAt.toISOString(),
            action: row.action,
            domain: DELETE_ACTION_DOMAIN[row.action] ?? "order",
            targetCode: row.targetCode,
            operator: { name: row.operatorNameSnapshot, role: row.operatorRoleSnapshot },
            detail: row.detailJson,
        }));
        return {
            items,
            nextCursor: hasMore && last ? { at: last.createdAt.toISOString(), id: last.id.toString() } : null,
        };
    }

    /** 时间范围 → [start, end) UTC 时刻（北京日界；口径与 /system-logs 一致） */
    private timeWindow(query: AgentDeletedQueryDto): { start: Date; end: Date } {
        const { start, nextStart } = beijingDayWindow();
        if (query.range === "custom") {
            if (!query.from || !query.to) {
                throw new BadRequestException("自定义范围必须填写开始与结束日期");
            }
            if (query.from > query.to) {
                throw new BadRequestException("开始日期不能晚于结束日期");
            }
            const fromWindow = beijingDayWindow(new Date(`${query.from}T00:00:00.000+08:00`));
            const toWindow = beijingDayWindow(new Date(`${query.to}T00:00:00.000+08:00`));
            return { start: fromWindow.start, end: toWindow.nextStart };
        }
        const days = query.range === "7d" ? 7 : query.range === "30d" ? 30 : 1;
        return { start: new Date(start.getTime() - (days - 1) * DAY_MS), end: nextStart };
    }
}
