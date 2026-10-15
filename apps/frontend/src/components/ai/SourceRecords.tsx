import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { ChatSource } from "./types";

const LABELS: Record<string, string> = {
    orderDate: "下单日期",
    deliverDate: "交货日期",
    createdBy: "创建人",
    updatedBy: "修改人",
    lifecycleStatus: "订单状态",
    archivedAt: "归档时间",
    archivedBy: "归档人",
    archivedByAccount: "归档人账号",
    archiveReason: "归档原因",
    creator: "建档人",
    created: "建档时间",
    inspector: "检验人",
    time: "登记时间",
    qtyDelta: "调整数量",
    relatedInboundNo: "关联入库单",
    balance: "变动后库存",
    flows: "库存流水",
    province: "省",
    city: "市",
    district: "区县",
    town: "乡镇",
    address: "地址",
    cooperation: "合作状态",
    ownerAccount: "负责人账号",
    payTerms: "付款条件",
    groupName: "物料分组",
    actor: "操作人",
    changes: "变更内容",
    before: "变更前",
    after: "变更后",
    label: "项目",
    key: "字段",
    items: "记录",
    orders: "订单",
    customers: "客户",
    boms: "BOM 档案",
    bomStocks: "库存",
    stocks: "库存",
    inbound: "入库",
    outbound: "出库",
    inboundByDay: "每日入库",
    outboundByDay: "每日出库",
    nodes: "节点",
    edges: "关联",
    facts: "业务数据",
    id: "记录 ID",
    code: "编号",
    no: "单号",
    orderNo: "订单号",
    entryNo: "入库单号",
    shipmentNo: "出库单号",
    bomCode: "BOM 编码",
    bomName: "成品",
    bomSpec: "规格",
    name: "名称",
    customerName: "客户",
    customerCode: "客户编码",
    customer: "客户",
    bom: "成品",
    categoryName: "品类",
    category: "品类",
    spec: "规格",
    specification: "规格",
    qty: "数量",
    quantity: "数量",
    orderQty: "订单数量",
    shippedQty: "有效已发",
    shipped: "已发",
    outstandingQty: "欠量",
    pendingQty: "欠量",
    stock: "库存",
    stockQty: "库存",
    availableQty: "可发量",
    type: "类型",
    status: "状态",
    state: "状态",
    lifecycle: "生命周期",
    date: "日期",
    businessDate: "业务日期",
    dueDate: "交期",
    deliveryDate: "交期",
    createdAt: "创建时间",
    updatedAt: "更新时间",
    occurredAt: "操作时间",
    voidedAt: "作废时间",
    voidedBy: "作废人",
    voidReason: "作废原因",
    remark: "备注",
    reason: "原因",
    action: "操作",
    domain: "业务范围",
    operator: "操作人",
    owner: "负责人",
    ownerName: "负责人",
    account: "账号",
    role: "角色",
    phone: "电话",
    contact: "联系人",
    targetCode: "目标编号",
    targetName: "目标名称",
    detail: "记录详情",
    version: "版本",
    unit: "单位",
    materialSummary: "物料构成",
    range: "时间范围",
    from: "开始日期",
    to: "结束日期",
    keyword: "关键词",
    limit: "返回上限",
};
const STATES: Record<string, string> = {
    ACTIVE: "进行中",
    ARCHIVED: "已归档",
    REGISTERED: "已登记",
    VOIDED: "已作废",
    active: "有效",
    archived: "已归档",
    registered: "已登记",
    voided: "已作废",
    inbound: "入库",
    outbound: "出库",
    adjustment: "库存调整",
    today: "今天",
    "7d": "最近 7 天",
    "30d": "最近 30 天",
    custom: "自定义",
    in: "入库",
    out: "出库",
    adjust: "库存调整",
    create: "新建",
    edit: "编辑",
    transfer: "移交",
    archive: "归档",
    unarchive: "归档回退",
    delete: "删除",
    void: "作废",
    ship: "发货",
    customer: "客户",
    order: "订单",
    bom: "BOM",
    bom_structure: "BOM 结构",
    super: "超级管理员",
    admin: "管理员",
    warehouse: "仓管",
    sales: "销售",
    staff: "员工",
};

function cell(value: unknown, key = ""): string {
    if (value === null || value === undefined) return "—";
    if (typeof value === "boolean") return value ? "是" : "否";
    if (typeof value === "string") {
        if (key === "lifecycleStatus" && value === "active") return "进行中";
        if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))
            return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
        return STATES[value] ?? value;
    }
    if (Array.isArray(value)) return value.map(item => cell(item)).join("、");
    if (typeof value === "object")
        return Object.entries(value)
            .map(([key, child]) => `${LABELS[key] ?? key}：${cell(child, key)}`)
            .join("；");
    return String(value);
}

export function SourceRecords({ source, onClose }: { source: ChatSource; onClose: () => void }) {
    const data = source.data;
    const groups = Array.isArray(data)
        ? [["items", data] as const]
        : data && typeof data === "object"
          ? Object.entries(data).filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
          : [];
    const [selected, setSelected] = useState(groups[0]?.[0] ?? "");
    const [page, setPage] = useState(0);
    const rows = groups.find(([key]) => key === selected)?.[1] ?? [];
    const columns = [
        ...new Set(rows.slice(0, 50).flatMap(row => (row && typeof row === "object" ? Object.keys(row) : ["value"]))),
    ].filter(key => !["id", "version", "rowVersion"].includes(key));
    const metadata = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
    return (
        <Modal
            open
            onClose={onClose}
            title={`${source.title} · 来源记录`}
            width={920}
            subtitle={`查询于 ${new Date(source.queriedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`}
        >
            <div className="space-y-4 text-13">
                <p className="text-muted">
                    {Object.keys(source.filters).length
                        ? Object.entries(source.filters)
                              .map(([key, value]) => `${LABELS[key] ?? key}：${cell(value)}`)
                              .join("；")
                        : "按接口默认范围查询"}
                </p>
                {metadata.nextCursor || (typeof metadata.total === "number" && metadata.total > rows.length) ? (
                    <p role="status" className="rounded-input bg-warning-soft p-3 text-warning">
                        当前结果尚未取全，请继续查询或缩小筛选范围。
                    </p>
                ) : null}
                {groups.length > 1 && (
                    <label className="flex items-center gap-2">
                        记录分类
                        <select
                            className="rounded-input border border-line bg-surface p-2"
                            value={selected}
                            onChange={event => {
                                setSelected(event.target.value);
                                setPage(0);
                            }}
                        >
                            {groups.map(([key, values]) => (
                                <option key={key} value={key}>
                                    {LABELS[key] ?? key}（{values.length}）
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                {groups.length ? (
                    <>
                        <div
                            className="max-h-[55dvh] overflow-auto rounded-xl border border-line"
                            tabIndex={0}
                            role="region"
                            aria-label="来源数据表格"
                        >
                            <table className="w-max min-w-full border-collapse text-left text-12.5">
                                <thead className="sticky top-0 bg-soft">
                                    <tr>
                                        {columns.map(key => (
                                            <th
                                                className="border-b border-line px-3 py-2 font-semibold"
                                                scope="col"
                                                key={key}
                                            >
                                                {key === "outbound" && source.title === "销售订单"
                                                    ? "有效已发"
                                                    : (LABELS[key] ?? key)}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.slice(page * 50, (page + 1) * 50).map((row, index) => (
                                        <tr key={page * 50 + index}>
                                            {columns.map(key => (
                                                <td
                                                    key={key}
                                                    className="max-w-80 border-b border-line px-3 py-2 wrap-anywhere align-top"
                                                >
                                                    {cell(
                                                        row && typeof row === "object"
                                                            ? (row as Record<string, unknown>)[key]
                                                            : row,
                                                        key,
                                                    )}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {!rows.length && <p className="p-6 text-muted">当前筛选范围没有记录。</p>}
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-muted">
                                本次返回 {rows.length} 条 · 第 {page + 1} / {Math.max(1, Math.ceil(rows.length / 50))}{" "}
                                页
                            </span>
                            <div className="flex gap-2">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={page === 0}
                                    onClick={() => setPage(current => current - 1)}
                                >
                                    上一页
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={(page + 1) * 50 >= rows.length}
                                    onClick={() => setPage(current => current + 1)}
                                >
                                    下一页
                                </Button>
                            </div>
                        </div>
                    </>
                ) : (
                    <dl className="space-y-2">
                        {Object.entries(metadata).map(([key, value]) => (
                            <div key={key}>
                                <dt className="font-medium">{LABELS[key] ?? key}</dt>
                                <dd className="wrap-anywhere text-muted">{cell(value)}</dd>
                            </div>
                        ))}
                    </dl>
                )}
            </div>
        </Modal>
    );
}
