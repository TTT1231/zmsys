/**
 * op_log detail_json 的字段契约（db-scheme.md §7，读写共享单一来源）：
 * 写侧 recordOpLog 按动作把 detail 收窄到此处的类型，读侧 system-logs 的
 * 渲染目录 key 受 keyof 约束——写侧改快照键名或读侧目录漂移都会在编译期
 * 报错（此前生产发生过 customerCode 键名漂移、卡片字段静默消失的事故）。
 * 全部用 type 别名而非 interface：type 具备隐式索引签名，可直接赋给 Prisma
 * 的 InputJsonValue（changeLog 的 before/after_json 同形态复用）。
 * 存量历史行可能仍是旧形态，读侧运行时保持逐键宽松判型，类型仅约束写入与键名。
 */

import type { Prisma } from "../generated/prisma/client";

/** 订单行内快照（orders.orderSnapshot）：before/after_json 与 op_log detail 的共同基底 */
export type OrderSnapshotCore = {
    orderNo: string;
    qty: number;
    orderDate: string;
    deliverDate: string;
    remark: string;
    /** 生命周期值 ACTIVE/ARCHIVED */
    lifecycleStatus: string;
    archivedAt: string | null;
    archiveReason: string | null;
    /** 客户名称/编码：建档冻结，编辑换客户时随行刷新（存量行可能缺键，读侧宽松判型） */
    customer: string;
    customerCode: string;
    /** BOM 编码（关联码）：换 BOM 编辑的审计可见性——同品类换 BOM 时 bomName 不变，靠编码成行 */
    bomCode: string;
    bomName: string;
    bomModel: string;
    /** 订单建档冻结的 BOM 快照（items/modelCode/spec）；编辑换 BOM 时重冻 */
    bomSpec: Prisma.JsonValue;
    rowVersion: number;
};

/** create_order：行内快照 + 客户/BOM 关联编码与建档备注（随日志冻结） */
export type OrderCreateEventDetail = OrderSnapshotCore & {
    customer: string;
    customerCode: string;
    bomCode: string;
    bomRemark: string;
};

/** archive_order：行内快照 + 归档人与原因（系统日志页 reason 展示依赖 detail） */
export type OrderArchiveEventDetail = OrderSnapshotCore & {
    customer: string;
    customerCode: string;
    bomCode: string;
    archivedBy: string | null;
    reason: string | null;
};

/** delete_order：删除后订单与 BOM 行均可能不复存在，op_log 是唯一留存 */
export type OrderDeleteEventDetail = OrderSnapshotCore & {
    customer: string;
    customerCode: string;
    bomCode: string;
    bomRemark: string;
    deletedAt: string;
};

/** 客户可编辑的 8 业务字段（update_customer detail 的 before/after 内嵌形态） */
export type CustomerEditableFields = {
    name: string;
    contactPerson: string;
    province: string | null;
    city: string | null;
    district: string | null;
    town: string | null;
    address: string | null;
    payTerms: string;
};

/** update_customer：普通编辑（全字段前后值，手机号只记是否变更）或负责人移交
 *  （离岗批量移交补写，与编辑写法的 ownerChanged 对齐并带批量标记） */
export type CustomerUpdateEventDetail =
    | {
          before: CustomerEditableFields;
          after: CustomerEditableFields;
          phoneChanged: boolean;
          ownerChanged: { from: string; to: string } | null;
      }
    | {
          name: string;
          ownerChanged: { from: string; to: string };
          batchId: string;
          reason: string;
      };

/** create_customer：客户名 + 负责人账号 */
export type CustomerCreateEventDetail = { name: string; ownerAccount: string };

/** 入库行内快照（inbound.entrySnapshot）：台账 before/after_json 与 op_log detail 共同基底 */
export type EntrySnapshotCore = {
    no: string;
    bomCode: string;
    qty: number;
    date: string;
    remark: string;
    /** 状态值 ACTIVE/VOIDED */
    status: string;
    version: number;
};

/** void_inbound：作废前后快照 + 原因 */
export type InboundVoidEventDetail = {
    before: EntrySnapshotCore;
    after: EntrySnapshotCore;
    reason: string;
};

/** delete_inbound：删除前快照 + 作废原因与删除人 */
export type InboundDeleteEventDetail = EntrySnapshotCore & {
    voidReason: string | null;
    deletedBy: string;
};

/** ship：发货关键事实（客户名快照供系统日志页按名称搜索） */
export type ShipEventDetail = {
    orderNo: string;
    qty: number;
    remark: string;
    customer: string;
};

/** 出库单头快照（outbound.shipmentSnapshot）：物理清理数量流水后仍能独立还原出库内容 */
export type ShipmentSnapshotCore = {
    no: string;
    orderNo: string;
    customer: string;
    customerCode: string;
    bomCode: string;
    qty: number;
    date: string;
    registeredAt: string;
    registeredBy: string;
    remark: string;
    /** 状态展示值 registered/voided */
    state: string;
    version: number;
};

/** void_outbound：单头快照 + 作废原因 */
export type OutboundVoidEventDetail = ShipmentSnapshotCore & { reason: string };

/** delete_outbound：单头快照 + 作废原因与删除人 */
export type OutboundDeleteEventDetail = ShipmentSnapshotCore & {
    voidReason: string | null;
    deletedBy: string;
};

/** 动作 → detail 形态映射；未登记的动作（create_bom/delete_bom 契约响应、
 *  db_backup/db_restore 系统审计）保持宽松 Prisma.InputJsonValue——读侧仅
 *  消费其稳定子集（name/spec/remark 等），新增动作应优先登记到此处 */
export type OpLogDetailOf = {
    create_order: OrderCreateEventDetail;
    archive_order: OrderArchiveEventDetail;
    delete_order: OrderDeleteEventDetail;
    create_customer: CustomerCreateEventDetail;
    update_customer: CustomerUpdateEventDetail;
    create_inbound: EntrySnapshotCore;
    void_inbound: InboundVoidEventDetail;
    delete_inbound: InboundDeleteEventDetail;
    ship: ShipEventDetail;
    void_outbound: OutboundVoidEventDetail;
    delete_outbound: OutboundDeleteEventDetail;
};
