/** 系统日志契约（openapi system-logs tag）：聚合 op_log 与各业务变更日志的
 * 统一事件模型；时间线页按天分组展示，(occurredAt, id) 复合游标分批追加。 */

export type SystemLogDomain = "customer" | "order" | "bom" | "inbound" | "outbound";

export type SystemLogAction = "create" | "edit" | "transfer" | "archive" | "delete" | "void" | "ship" | "adjust";

/** 单条变更（服务端产出中文 label 与展示值；before=null 表示新建记录。
 *  key 为语义源字段名（bomCode/orderNo 等），前端据此渲染可点击编号链接） */
export interface SystemLogChange {
    key?: string;
    label: string;
    before: string | null;
    after: string | null;
}

export interface SystemLogEntry {
    /** 来源行雪花 id（BigInt 序列化为 string，降序游标用） */
    id: string;
    /** 事件时刻 ISO（来源行 created_at，UTC） */
    occurredAt: string;
    /** 操作人（op_log 来源为姓名/角色快照；change_log/调整来源 join sys_user 当前值） */
    actor: { name: string; role: string };
    domain: SystemLogDomain;
    action: SystemLogAction;
    /** 目标编号：订单号 / 客户编码 / BOM 编码 / 入库单号 / 出库单号 / 调整单号 */
    targetCode: string;
    /** 目标名称快照（客户名 / BOM 品类名等）；无名称路径的事件为 null */
    targetName: string | null;
    /** 字段级变更（创建/删除类为关键事实条目）；无变更语义的事件为 null */
    changes: SystemLogChange[] | null;
    /** 操作原因（归档/作废/移交/调整填写；未填为 null） */
    reason: string | null;
}

/** 复合游标：本批末条的 (occurredAt, id)；取下一批时回传 */
export interface SystemLogCursor {
    at: string;
    id: string;
}

export interface SystemLogPage {
    items: SystemLogEntry[];
    nextCursor: SystemLogCursor | null;
}
