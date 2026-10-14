/** 系统日志卡片变更提取（纯函数，node 直跑单测）：从各来源的 detail/before/after
 * JSON 产出统一的中文字段变更列表；值格式贴近时间线展示（数量带单位"个"、
 * 日期 yyyy-MM-dd、状态中文），before=null 表示新建记录。每行携带语义 key
 * （源字段名），前端据此把 BOM 编码/订单号等渲染为可点击编号链接。
 * 字段目录与 detail 形态的类型契约来自 domain/snapshots.ts（读写共享单一来源）：
 * 目录 key 受 keyof 约束、手写卡片的键名经类型化视图访问——写侧改快照键名
 * 或读侧目录漂移都会编译期报错。运行时保持逐键宽松判型（存量行可能为旧形态）。 */
import { bomSpecOf } from "../common/bom-display";
import type {
    BomCategoryCreateEventDetail,
    BomCategoryDeleteEventDetail,
    BomStructureUpdateEventDetail,
    CustomerDeleteEventDetail,
    CustomerEditableFields,
    EntrySnapshotCore,
    InboundVoidEventDetail,
    OrderArchiveEventDetail,
    OrderCreateEventDetail,
    OrderUnarchiveEventDetail,
    OrderSnapshotCore,
    ShipEventDetail,
    ShipmentSnapshotCore,
    StructureChangeSummaryJson,
} from "../domain/snapshots";
import type { SystemLogChange } from "./types";

/** JSON detail 的宽松读取类型（快照字段形态随动作不同，逐键判型） */
type Json = Record<string, unknown>;

const asJson = (value: unknown): Json | null => (value && typeof value === "object" ? (value as Json) : null);
const asText = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value.length ? value : null;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return null;
};
const qtyText = (value: unknown): string | null => (typeof value === "number" ? `${value} 个` : asText(value));

interface FieldSpec<K extends string> {
    key: K;
    label: string;
    format?: (value: unknown) => string | null;
}

/** 订单快照字段目录（orderSnapshot 同构）：label 中文映射；rowVersion 等技术字段不在目录。
 * customer（名称快照）随"编辑换客户"入 before/after——编辑卡片可展示客户变更
 * （存量历史行缺键时 asText 判 null 自动跳过，不渲染该行） */
const ORDER_FIELDS: ReadonlyArray<FieldSpec<keyof OrderSnapshotCore>> = [
    { key: "qty", label: "订单数量", format: qtyText },
    { key: "orderDate", label: "下单日期" },
    { key: "deliverDate", label: "交货日期" },
    { key: "remark", label: "备注" },
    { key: "customer", label: "客户" },
    {
        key: "lifecycleStatus",
        label: "订单状态",
        format: value => (value === "ACTIVE" ? "进行中" : value === "ARCHIVED" ? "已归档" : asText(value)),
    },
    { key: "bomCode", label: "BOM 编码" },
    { key: "bomName", label: "成品名称" },
];

/** 入库快照字段目录（entrySnapshot 同构） */
const INBOUND_FIELDS: ReadonlyArray<FieldSpec<keyof EntrySnapshotCore>> = [
    { key: "bomCode", label: "BOM 编码" },
    { key: "qty", label: "入库数量", format: qtyText },
    { key: "date", label: "业务日期" },
    { key: "remark", label: "备注" },
    {
        key: "status",
        label: "状态",
        format: value => (value === "ACTIVE" ? "有效" : value === "VOIDED" ? "已作废" : asText(value)),
    },
];

/** 客户编辑 detail.before/after 字段目录（updateCustomer 写入的 8 字段） */
const CUSTOMER_FIELDS: ReadonlyArray<FieldSpec<keyof CustomerEditableFields>> = [
    { key: "name", label: "客户名称" },
    { key: "contactPerson", label: "联系人" },
    { key: "province", label: "省" },
    { key: "city", label: "市" },
    { key: "district", label: "区县" },
    { key: "town", label: "乡镇" },
    { key: "address", label: "详细地址" },
    { key: "payTerms", label: "付款条件" },
];

function diffByFields<K extends string>(
    before: Json | null,
    after: Json | null,
    fields: ReadonlyArray<FieldSpec<K>>,
): SystemLogChange[] {
    const source = after ?? before ?? {};
    const changes: SystemLogChange[] = [];
    for (const field of fields) {
        // 省市区县乡镇四段合并为一条"所在地区"变更（碎片化展示不可读）。
        // 按 key 判别而非 label 文案：改展示措辞不会改变合并行为
        if (field.key === "city" || field.key === "district" || field.key === "town") continue;
        const format = field.format ?? asText;
        if (field.key === "province") {
            const regionOf = (row: Json | null) =>
                ["province", "city", "district", "town"]
                    .map(key => asText(row?.[key]))
                    .filter(part => part !== null)
                    .join(" / ") || null;
            const beforeRegion = before ? regionOf(before) : null;
            const afterRegion = regionOf(after);
            if (beforeRegion !== afterRegion) {
                changes.push({ key: "region", label: "所在地区", before: beforeRegion, after: afterRegion });
            }
            continue;
        }
        const beforeValue = before ? format(before[field.key]) : null;
        const afterValue = format(source[field.key]);
        if (beforeValue !== afterValue) {
            changes.push({ key: field.key, label: field.label, before: beforeValue, after: afterValue });
        }
    }
    return changes;
}

/** op_log 动作 → 卡片变更列表；返回 null 表示该事件无字段级变更语义 */
export function changesOfOpLog(action: string, detail: Json | null): SystemLogChange[] | null {
    switch (action) {
        case "create_order":
        case "delete_order": {
            // detail 为订单完整快照：创建/删除展示关键事实（before=null）；BOM 冻结
            // 快照一并透出——删除后订单与 BOM 行均可能不复存在，本日志是唯一留存
            const snapshot = (detail ?? {}) as OrderCreateEventDetail;
            return [
                { key: "customer", label: "客户", before: null, after: asText(snapshot.customer) },
                { key: "bomCode", label: "BOM 编码", before: null, after: asText(snapshot.bomCode) },
                { key: "bomName", label: "成品名称", before: null, after: asText(snapshot.bomName) },
                { key: "bomSpec", label: "规格构成", before: null, after: asText(bomSpecOf(snapshot.bomSpec)) },
                { key: "bomRemark", label: "BOM 备注", before: null, after: asText(snapshot.bomRemark) },
                { key: "qty", label: "订单数量", before: null, after: qtyText(snapshot.qty) },
                { key: "deliverDate", label: "交货日期", before: null, after: asText(snapshot.deliverDate) },
                { key: "remark", label: "备注", before: null, after: asText(snapshot.remark) },
            ].filter(change => change.after !== null);
        }
        case "archive_order": {
            // 归档前必为 ACTIVE（终态不可再归档），状态变更可推断；数量为归档时口径
            const snapshot = (detail ?? {}) as OrderArchiveEventDetail;
            return [
                { key: "customer", label: "客户", before: null, after: asText(snapshot.customer) },
                { key: "lifecycleStatus", label: "订单状态", before: "进行中", after: "已归档" },
                { key: "qty", label: "订单数量", before: null, after: qtyText(snapshot.qty) },
            ].filter(change => change.after !== null);
        }
        case "unarchive_order": {
            // 回退前必为 ARCHIVED（未归档不可回退），状态变更可推断；数量为回退时口径
            const snapshot = (detail ?? {}) as OrderUnarchiveEventDetail;
            return [
                { key: "customer", label: "客户", before: null, after: asText(snapshot.customer) },
                { key: "lifecycleStatus", label: "订单状态", before: "已归档", after: "进行中" },
                { key: "qty", label: "订单数量", before: null, after: qtyText(snapshot.qty) },
            ].filter(change => change.after !== null);
        }
        case "update_customer": {
            if (!detail) return null;
            const ownerChanged = asJson(detail.ownerChanged);
            if (ownerChanged) {
                // 负责人移交（页面编辑或离岗批量）：客户名 + 移交事实
                return [
                    { key: "name", label: "客户名称", before: null, after: asText(detail.name) },
                    {
                        key: "owner",
                        label: "负责销售",
                        before: asText(ownerChanged.from),
                        after: asText(ownerChanged.to),
                    },
                ];
            }
            const changes = diffByFields(asJson(detail.before), asJson(detail.after) ?? {}, CUSTOMER_FIELDS);
            if (detail.phoneChanged === true) {
                changes.push({
                    key: "phone",
                    label: "联系电话",
                    before: "原号码不展示",
                    after: "已变更，号码不展示",
                });
            }
            return changes;
        }
        case "create_customer":
            return [
                { key: "name", label: "客户名称", before: null, after: asText(detail?.name) },
                { key: "ownerAccount", label: "负责销售", before: null, after: asText(detail?.ownerAccount) },
            ].filter(change => change.after !== null);
        case "delete_customer": {
            // detail 为删除前档案快照：删除后客户行不复存在，本日志是唯一留存
            const snapshot = (detail ?? {}) as CustomerDeleteEventDetail;
            const region =
                [snapshot.province, snapshot.city, snapshot.district, snapshot.town]
                    .map(part => asText(part))
                    .filter(part => part !== null)
                    .join(" / ") || null;
            return [
                { key: "name", label: "客户名称", before: null, after: asText(snapshot.name) },
                { key: "contact", label: "联系人", before: null, after: asText(snapshot.contact) },
                { key: "region", label: "所在地区", before: null, after: region },
                { key: "address", label: "详细地址", before: null, after: asText(snapshot.address) },
                { key: "payTerms", label: "付款条件", before: null, after: asText(snapshot.payTerms) },
                { key: "owner", label: "负责销售", before: null, after: asText(snapshot.owner) },
                { key: "created", label: "建档时间", before: null, after: asText(snapshot.created) },
            ].filter(change => change.after !== null);
        }
        case "create_bom":
        case "delete_bom": {
            // detail 为 BOM 契约响应/删除前快照
            return [
                { key: "name", label: "成品名称", before: null, after: asText(detail?.name) },
                { key: "spec", label: "规格构成", before: null, after: asText(detail?.spec) },
                { key: "remark", label: "备注", before: null, after: asText(detail?.remark) },
            ].filter(change => change.after !== null);
        }
        case "create_inbound":
        case "delete_inbound": {
            const snapshot = (detail ?? {}) as EntrySnapshotCore;
            return INBOUND_FIELDS.map(field => ({
                key: field.key,
                label: field.label,
                before: null,
                after: (field.format ?? asText)(snapshot[field.key]),
            })).filter(change => change.after !== null);
        }
        case "void_inbound": {
            const snapshot = (detail ?? {}) as InboundVoidEventDetail;
            // 作废只改 status，纯 diff 会滤掉未变的 bomCode/qty——卡片看不到作废的是
            // 哪个 BOM；补关键事实行（before=null 展示口径，同 archive_order），再附状态 diff
            const facts = asJson(snapshot.before) ?? asJson(snapshot.after);
            const context: SystemLogChange[] = [
                { key: "bomCode", label: "BOM 编码", before: null, after: asText(facts?.bomCode) },
                { key: "qty", label: "入库数量", before: null, after: qtyText(facts?.qty) },
            ].filter(change => change.after !== null);
            return [...context, ...diffByFields(asJson(snapshot.before), asJson(snapshot.after), INBOUND_FIELDS)];
        }
        case "ship": {
            const snapshot = (detail ?? {}) as ShipEventDetail;
            return [
                { key: "customer", label: "客户", before: null, after: asText(snapshot.customer) },
                { key: "qty", label: "发货数量", before: null, after: qtyText(snapshot.qty) },
                { key: "orderNo", label: "订单号", before: null, after: asText(snapshot.orderNo) },
                { key: "remark", label: "备注", before: null, after: asText(snapshot.remark) },
            ].filter(change => change.after !== null);
        }
        case "void_outbound":
        case "delete_outbound": {
            // shipmentSnapshot：客户与数量/订单号关键事实
            const snapshot = (detail ?? {}) as ShipmentSnapshotCore;
            return [
                { key: "customer", label: "客户", before: null, after: asText(snapshot.customer) },
                { key: "qty", label: "出库数量", before: null, after: qtyText(snapshot.qty) },
                { key: "orderNo", label: "订单号", before: null, after: asText(snapshot.orderNo) },
            ].filter(change => change.after !== null);
        }
        case "create_bom_category": {
            const snapshot = (detail ?? {}) as BomCategoryCreateEventDetail;
            return [
                { key: "name", label: "品类名称", before: null, after: asText(snapshot.name) },
                { key: "codePrefix", label: "编码前缀", before: null, after: asText(snapshot.codePrefix) },
                {
                    key: "structure",
                    label: "目录结构",
                    before: null,
                    after: `${snapshot.sections} 分区 · ${snapshot.groups} 分组 · ${snapshot.items} 物料`,
                },
                ...(snapshot.types?.length
                    ? [
                          {
                              key: "types",
                              label: "下属类型",
                              before: null,
                              after: snapshot.types.map(type => `${type.name}（${type.codePrefix}）`).join("、"),
                          },
                      ]
                    : []),
            ].filter(change => change.after !== null);
        }
        case "delete_bom_category": {
            const deleted = (detail ?? {}) as BomCategoryDeleteEventDetail;
            if (!detail) {
                return null;
            }
            const rows: SystemLogChange[] = [
                { key: "name", label: "品类名称", before: null, after: asText(deleted.name) },
                { key: "codePrefix", label: "编码前缀", before: null, after: asText(deleted.codePrefix) },
                {
                    key: "structure",
                    label: "删除规模",
                    before: null,
                    after: `${deleted.sections} 分区 · ${deleted.groups} 分组 · ${deleted.items} 物料 · ${deleted.boms} 份 BOM 档案`,
                },
            ];
            if (deleted.types?.length) {
                rows.push({
                    key: "types",
                    label: "下属类型",
                    before: null,
                    after: deleted.types.map(type => `${type.name}（${type.codePrefix}）`).join("、"),
                });
            }
            return rows;
        }
        case "update_bom_structure": {
            const snapshot = (detail ?? {}) as BomStructureUpdateEventDetail;
            if (!detail || (snapshot.operations?.length !== undefined && snapshot.operations.length === 0)) {
                return null;
            }
            const typeLabel: Record<StructureChangeSummaryJson["nodeType"], string> = {
                section: "分区",
                group: "分组",
                item: "物料",
            };
            const describe = (entry: StructureChangeSummaryJson): string => {
                if (entry.added) {
                    return `${typeLabel[entry.nodeType]}「${entry.name}」新增`;
                }
                if (entry.removed) {
                    return `${typeLabel[entry.nodeType]}「${entry.name}」删除`;
                }
                const parts: string[] = [];
                const before = entry.before ?? {};
                const after = entry.after ?? {};
                if (before.status !== undefined || after.status !== undefined) {
                    parts.push(after.status === false ? "隐藏" : "恢复显示");
                }
                if (before.name !== undefined || after.name !== undefined) {
                    parts.push(`改名「${before.name ?? "?"}」→「${after.name ?? "?"}」`);
                }
                if (before.multi !== undefined || before.qty !== undefined) {
                    parts.push(
                        `${before.multi ? "多选" : "单选"}${before.qty ? "+数量" : ""} → ${after.multi ? "多选" : "单选"}${after.qty ? "+数量" : ""}`,
                    );
                }
                if (before.parent !== undefined || after.parent !== undefined) {
                    parts.push(
                        entry.nodeType === "item"
                            ? `移入分组「${after.parent ?? "?"}」`
                            : `移入${after.parent === null ? "品类根" : `分区「${after.parent}」`}`,
                    );
                }
                if (before.position !== undefined || after.position !== undefined) {
                    parts.push(`第 ${before.position ?? "?"} 位 → 第 ${after.position ?? "?"} 位`);
                }
                if (parts.length === 0) {
                    parts.push("调整");
                }
                return `${typeLabel[entry.nodeType]}「${entry.name}」${parts.join("，")}`;
            };
            const changes: SystemLogChange[] = [
                { key: "category", label: "品类", before: null, after: asText(snapshot.name) },
                {
                    key: "version",
                    label: "目录版本",
                    before: snapshot.rowVersionBefore === undefined ? null : String(snapshot.rowVersionBefore),
                    after: snapshot.rowVersionAfter === undefined ? null : String(snapshot.rowVersionAfter),
                },
                ...snapshot.operations.map((entry, index) => ({
                    key: `op-${index}`,
                    label: `变动 ${index + 1}`,
                    before: null,
                    after: describe(entry),
                })),
            ];
            if (snapshot.hiddenUsage !== undefined && snapshot.hiddenUsage > 0) {
                changes.push({
                    key: "hiddenUsage",
                    label: "隐藏物料引用",
                    before: null,
                    after: `仍被 ${snapshot.hiddenUsage} 行既有 BOM 明细引用（不影响旧档案）`,
                });
            }
            return changes.filter(change => change.after !== null);
        }
        default:
            return null;
    }
}

/** 库存调整事件（stock_adjustment 表行）的变更列表；productName 为调整 BOM 的品类名
 *  （目标行不再展示 targetName，成品上下文由本行承载） */
export function changesOfAdjustment(
    qtyDelta: number,
    relatedInboundNo: string | null,
    productName: string | null,
): SystemLogChange[] {
    const changes: SystemLogChange[] = [
        { key: "bomName", label: "成品名称", before: null, after: productName },
        {
            key: "qtyDelta",
            label: "调整数量",
            before: null,
            after: `${qtyDelta > 0 ? "+" : ""}${qtyDelta} 个`,
        },
    ].filter(change => change.after !== null);
    if (relatedInboundNo) {
        changes.push({ key: "relatedInboundNo", label: "关联入库单", before: null, after: relatedInboundNo });
    }
    return changes;
}

/** 订单编辑事件（sales_order_change_log UPDATE）的变更列表 */
export function changesOfOrderEdit(beforeJson: Json | null, afterJson: Json | null): SystemLogChange[] {
    return diffByFields(beforeJson, afterJson, ORDER_FIELDS);
}

/** 入库修正事件（inbound_change_log UPDATE）的变更列表 */
export function changesOfInboundEdit(beforeJson: Json | null, afterJson: Json | null): SystemLogChange[] {
    return diffByFields(beforeJson, afterJson, INBOUND_FIELDS);
}

/** reason 展示：空串归一为 null（原型仅在 details 内末尾展示非空原因） */
export const reasonText = (value: unknown): string | null => {
    const text = asText(value);
    return text && text.length > 0 ? text : null;
};
