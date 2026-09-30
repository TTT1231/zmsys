import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { beijingDayWindow } from "../common/beijing-day";
import {
    changesOfAdjustment,
    changesOfInboundEdit,
    changesOfOpLog,
    changesOfOrderEdit,
    reasonText,
} from "./change-details";
import type { SystemLogsQueryDto } from "./system-logs-query.dto";
import type { SystemLogAction, SystemLogDomain, SystemLogEntry, SystemLogPage } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 聚合来源行（四臂 UNION ALL 的统一列形；各臂以 NULL 补齐不适用列） */
interface LogSourceRow {
    id: bigint;
    created_at: Date;
    actor_name: string;
    actor_role: string;
    domain: string;
    action: string;
    /** op_log 臂的原始动作（update_customer 等）；其余臂 NULL——changes 提取依赖 */
    op_action: string | null;
    target_code: string;
    target_name: string | null;
    /** op_log 臂的 detail_json；其余臂 NULL */
    detail_json: unknown;
    /** 订单/入库编辑臂的 before/after；其余臂 NULL */
    before_json: unknown;
    after_json: unknown;
    reason: string | null;
    /** 调整臂的数量差与关联入库单号；其余臂 NULL */
    qty_delta: number | null;
    related_no: string | null;
}

/** op_log 动作 → 业务域 */
const OP_LOG_DOMAIN = {
    create_order: "order",
    archive_order: "order",
    delete_order: "order",
    create_customer: "customer",
    update_customer: "customer",
    create_bom: "bom",
    delete_bom: "bom",
    create_inbound: "inbound",
    void_inbound: "inbound",
    delete_inbound: "inbound",
    ship: "outbound",
    void_outbound: "outbound",
    delete_outbound: "outbound",
} as const;

/** op_log 动作 → 操作类型（update_customer 再按 ownerChanged 拆分 transfer/edit） */
const OP_LOG_ACTION = {
    create_order: "create",
    archive_order: "archive",
    delete_order: "delete",
    create_customer: "create",
    update_customer: "edit",
    create_bom: "create",
    delete_bom: "delete",
    create_inbound: "create",
    void_inbound: "void",
    delete_inbound: "delete",
    ship: "ship",
    void_outbound: "void",
    delete_outbound: "delete",
} as const;

const actionsOfDomain = (domain: SystemLogDomain): string =>
    Object.entries(OP_LOG_DOMAIN)
        .filter(([, value]) => value === domain)
        .map(([action]) => `'${action}'`)
        .join(", ");

const actionsOfType = (action: Exclude<SystemLogAction, "transfer" | "edit">): string =>
    Object.entries(OP_LOG_ACTION)
        .filter(([, value]) => value === action)
        .map(([opAction]) => `'${opAction}'`)
        .join(", ");

/** LIKE 关键词转义（%/_/\ 通配符按字面匹配；SQL 文本需 ESCAPE '\\'——JS 源码四反斜杠） */
const escapeLike = (keyword: string): string => keyword.replace(/[\\%_]/g, char => `\\${char}`);

const likeValue = (keyword: string): string => `%${escapeLike(keyword)}%`;

/** 恒假空臂：筛选已判定该臂无命中行时短路（保持 UNION 列形对齐） */
const EMPTY_ARM = Prisma.sql`SELECT NULL AS id, NULL AS created_at, NULL AS actor_name, NULL AS actor_role,
    NULL AS domain, NULL AS action, NULL AS op_action, NULL AS target_code, NULL AS target_name,
    NULL AS detail_json, NULL AS before_json, NULL AS after_json, NULL AS reason,
    NULL AS qty_delta, NULL AS related_no FROM DUAL WHERE FALSE`;

/**
 * 系统日志聚合查询（契约 system-logs:view，仅 super）：四来源 UNION ALL——
 * op_log（13 种业务动作；db_backup/db_restore 为系统审计，不进入业务时间线；
 * customer 域唯一卡片源，离岗批量移交亦写 op_log）、
 * sales_order_change_log（仅 UPDATE；CREATE/ARCHIVE 由 op_log 出，天然去重；
 * 订单物理清理时同事务先删日志，FK 保证无孤儿行，直接 INNER JOIN）、
 * inbound_change_log（仅 UPDATE，当天窗口修正台账）、stock_adjustment（追加表
 * 即日志，adjust 动作）。分批为 (occurredAt, id) 复合游标——并发事务中 createdAt
 * 与雪花 id 顺序可能倒置，时间线按操作时间排列是语义需求。关键词匹配操作人
 * 姓名/目标编号/目标名称三项；名称命中依赖快照存在，存量 create_order/ship 等
 * 旧日志无名称快照，按名称搜不到属预期降级（db-scheme.md §8），不做回填。
 */
@Injectable()
export class SystemLogsService {
    constructor(private readonly prisma: PrismaService) {}

    async listLogs(query: SystemLogsQueryDto): Promise<SystemLogPage> {
        const window = this.timeWindow(query);
        const cursorAt = query.beforeAt !== undefined && query.beforeId !== undefined ? new Date(query.beforeAt) : null;
        if (cursorAt && Number.isNaN(cursorAt.getTime())) {
            throw new BadRequestException("beforeAt 须为合法 ISO 时刻");
        }
        const cursorId = query.beforeId !== undefined ? BigInt(query.beforeId) : null;
        // 多取 1 条判断是否还有下一批；游标取本批末条
        const take = query.limit + 1;

        const rows = await this.prisma.$queryRaw<LogSourceRow[]>(Prisma.sql`
            SELECT * FROM (
                ${this.opLogArm(query, window, cursorAt, cursorId)}
                UNION ALL
                ${this.orderChangeArm(query, window, cursorAt, cursorId)}
                UNION ALL
                ${this.inboundChangeArm(query, window, cursorAt, cursorId)}
                UNION ALL
                ${this.adjustmentArm(query, window, cursorAt, cursorId)}
            ) AS unified
            ORDER BY unified.created_at DESC, unified.id DESC
            LIMIT ${take}
        `);

        const hasMore = rows.length > query.limit;
        const batch = hasMore ? rows.slice(0, query.limit) : rows;
        await this.backfillOrderBomRemark(batch);
        const last = batch.at(-1);
        return {
            items: batch.map(row => this.toEntry(row)),
            nextCursor: hasMore && last ? { at: last.created_at.toISOString(), id: last.id.toString() } : null,
        };
    }

    /**
     * 老订单日志（bomRemark 入快照之前写入）按 detail.bomCode 回填 BOM 建档
     * 备注：BOM 建档后不可修改且被订单引用即不可删除，实时值恒等于建档值，
     * 回填不引入漂移；BOM 备注为空时不改写（与空值不展示口径一致）
     */
    private async backfillOrderBomRemark(rows: LogSourceRow[]): Promise<void> {
        const pending = new Map<string, Record<string, unknown>>();
        for (const row of rows) {
            const detail = (row.detail_json ?? null) as Record<string, unknown> | null;
            if (
                (row.op_action === "create_order" || row.op_action === "delete_order") &&
                detail !== null &&
                detail.bomRemark === undefined &&
                typeof detail.bomCode === "string" &&
                detail.bomCode.length > 0
            ) {
                pending.set(detail.bomCode, detail);
            }
        }
        if (pending.size === 0) {
            return;
        }
        const boms = await this.prisma.bomTable.findMany({
            where: { bomCode: { in: [...pending.keys()] } },
            select: { bomCode: true, remark: true },
        });
        for (const bom of boms) {
            if (bom.remark.length > 0) {
                pending.get(bom.bomCode)!.bomRemark = bom.remark;
            }
        }
    }

    /** 时间范围 → [start, end) UTC 时刻（北京日界；today/7d/30d 均含今天） */
    private timeWindow(query: SystemLogsQueryDto): { start: Date; end: Date } {
        const { start, nextStart } = beijingDayWindow();
        if (query.range === "custom") {
            if (!query.from || !query.to) {
                throw new BadRequestException("自定义范围必须填写开始与结束日期");
            }
            if (query.from > query.to) {
                throw new BadRequestException("开始日期不能晚于结束日期");
            }
            // DATE 列语义的起止日按北京零点换算为 UTC 时刻（含 to 当天：end = to 次日零点）
            const fromWindow = beijingDayWindow(new Date(`${query.from}T00:00:00.000+08:00`));
            const toWindow = beijingDayWindow(new Date(`${query.to}T00:00:00.000+08:00`));
            return { start: fromWindow.start, end: toWindow.nextStart };
        }
        const days = query.range === "7d" ? 7 : query.range === "30d" ? 30 : 1;
        return { start: new Date(start.getTime() - (days - 1) * DAY_MS), end: nextStart };
    }

    /** 时间窗口 + 复合游标（alias 为各臂表别名；游标严格小于，防重复/漏行） */
    private rangeFilters(
        alias: string,
        window: { start: Date; end: Date },
        cursorAt: Date | null,
        cursorId: bigint | null,
    ): Prisma.Sql {
        const table = Prisma.raw(alias);
        const base = Prisma.sql`${table}.created_at >= ${window.start} AND ${table}.created_at < ${window.end}`;
        if (cursorAt && cursorId !== null) {
            return Prisma.sql`${base} AND (${table}.created_at < ${cursorAt}
                OR (${table}.created_at = ${cursorAt} AND ${table}.id < ${cursorId}))`;
        }
        return base;
    }

    /** 臂一：op_log 业务动作（update_customer 按 ownerChanged 拆分 transfer/edit） */
    private opLogArm(
        query: SystemLogsQueryDto,
        window: { start: Date; end: Date },
        cursorAt: Date | null,
        cursorId: bigint | null,
    ): Prisma.Sql {
        const domainExpr = Prisma.raw(
            `CASE ${Object.entries(OP_LOG_DOMAIN)
                .map(([action, domain]) => `WHEN o.action = '${action}' THEN '${domain}'`)
                .join(" ")} END`,
        );
        // 搜索型 CASE：transfer 分支必须先于 update_customer 的普通 edit 分支
        // （CASE 按顺序匹配，否则移交行永远落到 'edit'）
        const actionExpr = Prisma.raw(
            `CASE WHEN o.action = 'update_customer' AND JSON_TYPE(JSON_EXTRACT(o.detail_json, '$.ownerChanged')) = 'OBJECT' THEN 'transfer' ${Object.entries(
                OP_LOG_ACTION,
            )
                .filter(([action]) => action !== "update_customer")
                .map(([action, mapped]) => `WHEN o.action = '${action}' THEN '${mapped}'`)
                .join(" ")} WHEN o.action = 'update_customer' THEN 'edit' END`,
        );
        const nameExpr = Prisma.raw(
            "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.detail_json, '$.customer')), " +
                "JSON_UNQUOTE(JSON_EXTRACT(o.detail_json, '$.name')), " +
                "JSON_UNQUOTE(JSON_EXTRACT(o.detail_json, '$.after.name')))",
        );
        const filters: Prisma.Sql[] = [
            this.rangeFilters("o", window, cursorAt, cursorId),
            Prisma.sql` AND o.action IN (${Prisma.join(Object.keys(OP_LOG_DOMAIN))})`,
        ];
        if (query.domain !== undefined) {
            filters.push(Prisma.sql` AND o.action IN (${Prisma.raw(actionsOfDomain(query.domain))})`);
        }
        if (query.action !== undefined) {
            filters.push(Prisma.sql` AND (${this.opLogActionCondition(query.action)})`);
        }
        if (query.keyword !== undefined) {
            const like = likeValue(query.keyword);
            // target_code 为 ascii_bin 列：中文关键词直接 LIKE 报排序规则冲突，先 CONVERT
            filters.push(
                Prisma.sql` AND (o.operator_name_snapshot LIKE ${like} ESCAPE '\\\\' OR CONVERT(o.target_code USING utf8mb4) LIKE ${like} ESCAPE '\\\\' OR ${nameExpr} LIKE ${like} ESCAPE '\\\\')`,
            );
        }
        return Prisma.sql`
            SELECT o.id, o.created_at, o.operator_name_snapshot AS actor_name,
                   o.operator_role_snapshot AS actor_role, ${domainExpr} AS domain,
                   ${actionExpr} AS action, o.action AS op_action, o.target_code,
                   ${nameExpr} AS target_name, o.detail_json,
                   NULL AS before_json, NULL AS after_json, NULL AS reason,
                   NULL AS qty_delta, NULL AS related_no
            FROM op_log AS o
            WHERE ${Prisma.join(filters, " ")}`;
    }

    /** 单个操作类型 → op_log 动作条件（transfer/edit 拆自 update_customer）。
     *  ownerChanged 为 JSON null（普通编辑）时 JSON_EXTRACT 返回 JSON null 而非
     *  SQL NULL，IS NOT NULL 恒真——必须用 JSON_TYPE 判 OBJECT 才是移交 */
    private opLogActionCondition(action: SystemLogAction): Prisma.Sql {
        if (action === "transfer") {
            return Prisma.sql`o.action = 'update_customer' AND JSON_TYPE(JSON_EXTRACT(o.detail_json, '$.ownerChanged')) = 'OBJECT'`;
        }
        if (action === "edit") {
            return Prisma.sql`o.action = 'update_customer' AND (JSON_EXTRACT(o.detail_json, '$.ownerChanged') IS NULL OR JSON_TYPE(JSON_EXTRACT(o.detail_json, '$.ownerChanged')) <> 'OBJECT')`;
        }
        return Prisma.sql`o.action IN (${Prisma.raw(actionsOfType(action))})`;
    }

    /** 臂二：订单编辑（change_log 仅 UPDATE；操作人 join sys_user 取当前姓名/角色） */
    private orderChangeArm(
        query: SystemLogsQueryDto,
        window: { start: Date; end: Date },
        cursorAt: Date | null,
        cursorId: bigint | null,
    ): Prisma.Sql {
        if (!this.armMatches(query, "order", "edit")) {
            return EMPTY_ARM;
        }
        const keyword = this.keywordFilters(query, "o.order_no", "o.customer_name_snapshot");
        return Prisma.sql`
            SELECT c.id, c.created_at, u.name AS actor_name, u.role_code AS actor_role,
                   'order' AS domain, 'edit' AS action, NULL AS op_action, o.order_no AS target_code,
                   o.customer_name_snapshot AS target_name,
                   NULL AS detail_json, c.before_json, c.after_json, c.reason,
                   NULL AS qty_delta, NULL AS related_no
            FROM sales_order_change_log AS c
            JOIN sales_order_table AS o ON o.id = c.order_id
            JOIN sys_user AS u ON u.id = c.operator_id
            WHERE c.event_type = 'UPDATE' AND ${this.rangeFilters("c", window, cursorAt, cursorId)}${keyword}`;
    }

    /** 臂三：入库当天修正（change_log 仅 UPDATE；BOM 品类名补 target_name） */
    private inboundChangeArm(
        query: SystemLogsQueryDto,
        window: { start: Date; end: Date },
        cursorAt: Date | null,
        cursorId: bigint | null,
    ): Prisma.Sql {
        if (!this.armMatches(query, "inbound", "edit")) {
            return EMPTY_ARM;
        }
        const keyword = this.keywordFilters(query, "i.entry_no", "bc.name");
        return Prisma.sql`
            SELECT c.id, c.created_at, u.name AS actor_name, u.role_code AS actor_role,
                   'inbound' AS domain, 'edit' AS action, NULL AS op_action, i.entry_no AS target_code,
                   bc.name AS target_name,
                   NULL AS detail_json, c.before_json, c.after_json, c.reason,
                   NULL AS qty_delta, NULL AS related_no
            FROM inbound_change_log AS c
            JOIN inbound_ledger AS i ON i.id = c.inbound_id
            LEFT JOIN bom_table AS b ON b.id = i.bom_id
            LEFT JOIN bom_category AS bc ON bc.id = b.category_id
            JOIN sys_user AS u ON u.id = c.operator_id
            WHERE c.event_type = 'UPDATE' AND ${this.rangeFilters("c", window, cursorAt, cursorId)}${keyword}`;
    }

    /** 臂四：库存调整（追加表即日志，adjust 动作；domain 归 inbound） */
    private adjustmentArm(
        query: SystemLogsQueryDto,
        window: { start: Date; end: Date },
        cursorAt: Date | null,
        cursorId: bigint | null,
    ): Prisma.Sql {
        if (!this.armMatches(query, "inbound", "adjust")) {
            return EMPTY_ARM;
        }
        const keyword = this.keywordFilters(query, "a.adjustment_no", "bc.name");
        return Prisma.sql`
            SELECT a.id, a.created_at, u.name AS actor_name, u.role_code AS actor_role,
                   'inbound' AS domain, 'adjust' AS action, NULL AS op_action,
                   a.adjustment_no AS target_code, bc.name AS target_name,
                   NULL AS detail_json, NULL AS before_json, NULL AS after_json, a.reason,
                   CAST(a.qty_delta AS SIGNED) AS qty_delta, ri.entry_no AS related_no
            FROM stock_adjustment AS a
            LEFT JOIN bom_table AS b ON b.id = a.bom_id
            LEFT JOIN bom_category AS bc ON bc.id = b.category_id
            LEFT JOIN inbound_ledger AS ri ON ri.id = a.related_inbound_id
            JOIN sys_user AS u ON u.id = a.operator_id
            WHERE ${this.rangeFilters("a", window, cursorAt, cursorId)}${keyword}`;
    }

    /** 筛选是否命中该臂的 (domain, action) 组合；不命中即整臂短路 */
    private armMatches(query: SystemLogsQueryDto, domain: SystemLogDomain, action: SystemLogAction): boolean {
        if (query.domain !== undefined && query.domain !== domain) {
            return false;
        }
        return query.action === undefined || query.action === action;
    }

    /** 关键词条件（change_log/调整臂：操作人姓名 + 目标编号 + 目标名称列名因臂而异；
     *  编号列为 ascii_bin，CONVERT 成 utf8mb4 再 LIKE 避免中文关键词排序规则冲突） */
    private keywordFilters(query: SystemLogsQueryDto, codeColumn: string, nameColumn: string): Prisma.Sql {
        if (query.keyword === undefined) {
            return Prisma.sql``;
        }
        const like = likeValue(query.keyword);
        const code = Prisma.raw(`CONVERT(${codeColumn} USING utf8mb4)`);
        const name = Prisma.raw(`CONVERT(${nameColumn} USING utf8mb4)`);
        return Prisma.sql` AND (u.name LIKE ${like} ESCAPE '\\\\' OR ${code} LIKE ${like} ESCAPE '\\\\' OR ${name} LIKE ${like} ESCAPE '\\\\')`;
    }

    /** 来源行 → 契约事件（changes 按来源分派：op_log detail / change_log diff / 调整行） */
    private toEntry(row: LogSourceRow): SystemLogEntry {
        const detail = (row.detail_json ?? null) as Record<string, unknown> | null;
        const beforeJson = (row.before_json ?? null) as Record<string, unknown> | null;
        const afterJson = (row.after_json ?? null) as Record<string, unknown> | null;
        let changes: SystemLogEntry["changes"];
        if (row.op_action !== null) {
            changes = changesOfOpLog(row.op_action, detail);
        } else if (row.domain === "inbound" && row.action === "adjust") {
            changes = changesOfAdjustment(row.qty_delta ?? 0, row.related_no, row.target_name);
        } else if (row.domain === "order") {
            changes = changesOfOrderEdit(beforeJson, afterJson);
        } else {
            changes = changesOfInboundEdit(beforeJson, afterJson);
        }
        return {
            id: row.id.toString(),
            occurredAt: row.created_at.toISOString(),
            actor: { name: row.actor_name, role: row.actor_role },
            domain: row.domain as SystemLogDomain,
            action: row.action as SystemLogAction,
            targetCode: row.target_code,
            targetName: row.target_name,
            changes,
            // op_log 无行级 reason：移交等原因在 detail_json.reason（其余来源用行级列）
            reason: reasonText(row.reason ?? detail?.reason),
        };
    }
}
