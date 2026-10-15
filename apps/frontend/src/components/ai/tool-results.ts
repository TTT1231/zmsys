type Row = Record<string, unknown>;
const MAX_RESULT_CHARS = 14_000;
const LOCAL_FIELDS: Record<string, string[]> = {
    "/orders": ["start", "end", "orderNo", "bomCode", "customerCode", "keyword"],
    "/inbound": ["start", "end", "bomCode", "status", "keyword"],
    "/outbound": ["start", "end", "orderNo", "bomCode", "customerCode", "status", "keyword"],
    "/stock-adjustments": ["start", "end", "bomCode", "keyword"],
    "/boms": ["bomCode", "keyword"],
    "/customers": ["customerCode", "keyword"],
    "/bom-stocks": ["bomCode"],
    "/workbench/overview": ["start", "end", "bomCode"],
};

export function localToolFilters(path: string): Record<string, { type: string; description: string }> {
    const descriptions: Record<string, string> = {
        start: "开始业务日期 YYYY-MM-DD（含当天）；查询今天时与 end 都填今天。浏览器按完整列表筛选。",
        end: "结束业务日期 YYYY-MM-DD（含当天）。",
        orderNo: "精确销售订单号。",
        bomCode: "精确成品编号。",
        customerCode: "精确客户编号。",
        status: "all 全部记录（默认，合计自动排除作废）；active 仅有效记录；voided 仅作废。",
        keyword: "按单号、成品编号、客户名称或备注查找。",
    };
    return Object.fromEntries(
        (LOCAL_FIELDS[path] ?? []).map(key => [key, { type: "string", description: descriptions[key]! }]),
    );
}

export function validateLocalFilters(path: string, fields: Row) {
    for (const key of LOCAL_FIELDS[path] ?? []) {
        const value = fields[key];
        if (value === undefined) continue;
        if (typeof value !== "string" || value.length > 100) throw new Error("查询条件须为不超过 100 字的文字");
        if (
            (key === "start" || key === "end") &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
                Number.isNaN(Date.parse(value)) ||
                new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value)
        )
            throw new Error("日期请使用 YYYY-MM-DD 格式");
        if (key === "status" && !["active", "voided", "all"].includes(value))
            throw new Error("请选择有效、作废或全部记录");
    }
    if (fields.start && fields.end && String(fields.start) > String(fields.end))
        throw new Error("开始日期不能晚于结束日期");
}

function object(value: unknown): Row {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}
function number(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
const voided = (row: Row) => row.status === "voided" || row.state === "voided";

function matches(path: string, row: Row, filters: Row): boolean {
    const date = String(path === "/orders" ? row.orderDate : (row.date ?? row.businessDate ?? "")).slice(0, 10);
    if (filters.start && date < String(filters.start)) return false;
    if (filters.end && date > String(filters.end)) return false;
    if (filters.bomCode && String(row.bomCode ?? row.code) !== filters.bomCode) return false;
    if (filters.orderNo && String(row.orderNo ?? row.no) !== filters.orderNo) return false;
    if (filters.customerCode && String(row.customerCode ?? row.code) !== filters.customerCode) return false;
    if (path === "/inbound" || path === "/outbound") {
        const status = filters.status ?? "all";
        if ((status === "active" && voided(row)) || (status === "voided" && !voided(row))) return false;
    }
    if (
        filters.keyword &&
        !JSON.stringify(row).toLocaleLowerCase().includes(String(filters.keyword).toLocaleLowerCase())
    )
        return false;
    return true;
}

/** 保留完整统计，明细按行省略；绝不截取半个 JSON 或用编号连续推断完整性。 */
export function prepareToolResult(path: string, raw: unknown, fields: Row, question: string): unknown {
    const filters = { ...fields };
    if (["/inbound", "/outbound"].includes(path)) filters.status ??= "all";
    if (
        ["/inbound", "/outbound", "/stock-adjustments", "/workbench/overview"].includes(path) &&
        !filters.start &&
        !filters.end &&
        question.includes("今天")
    ) {
        const today = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Shanghai",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(new Date());
        filters.start = today;
        filters.end = today;
    }
    const source = object(raw);
    if (typeof source.markdown === "string") {
        if (source.markdown.length <= MAX_RESULT_CHARS - 500) return source;
        const sections = source.markdown.split(/(?=^## )/m);
        const terms = question.match(/删除|订单|出库|入库|客户|BOM|结构|分析|库存|归档|权限/g) ?? [];
        const selected = sections
            .map((text, index) => ({
                text,
                index,
                score: terms.filter(term => text.slice(0, 140).includes(term)).length,
            }))
            .sort((a, b) => b.score - a.score || a.index - b.index);
        let markdown = sections[0] ?? "";
        for (const section of selected.filter(section => section.index > 0)) {
            if (markdown.length + section.text.length < MAX_RESULT_CHARS - 500) markdown += section.text;
        }
        return { ...source, markdown, selectedSections: true };
    }
    if (path === "/workbench/overview") {
        const movements = (Array.isArray(source.movements) ? source.movements : [])
            .map(object)
            .filter(row => matches(path, row, filters));
        const products = (Array.isArray(source.products) ? source.products : [])
            .map(object)
            .filter(row => !filters.bomCode || row.code === filters.bomCode);
        const orders = (Array.isArray(source.orders) ? source.orders : [])
            .map(object)
            .filter(row => !filters.bomCode || row.bomCode === filters.bomCode);
        const productUnits = new Map(products.map(row => [row.code, String(row.unit ?? "未提供单位")]));
        const quantities = new Map<string, { unit: string; inboundQty: number; outboundQty: number }>();
        for (const row of movements) {
            const unit = productUnits.get(row.bomCode) ?? "未提供单位";
            const total = quantities.get(unit) ?? { unit, inboundQty: 0, outboundQty: 0 };
            total.inboundQty += number(row.inbound);
            total.outboundQty += number(row.outbound);
            quantities.set(unit, total);
        }
        return fit({
            asOf: source.asOf,
            unit: source.unit,
            scope: filters,
            summaryComplete: true,
            summary: {
                ...(quantities.size <= 1
                    ? {
                          inboundQty: movements.reduce((sum, row) => sum + number(row.inbound), 0),
                          outboundQty: movements.reduce((sum, row) => sum + number(row.outbound), 0),
                      }
                    : {}),
                quantitiesByUnit: [...quantities.values()],
                note: "出入库按业务日期统计，出库包含作废的抵消；不含库存调整。不同计量单位的数量不能混加。",
            },
            products,
            productCount: products.length,
            orders,
            orderCount: orders.length,
            records: movements,
            recordCount: movements.length,
        });
    }
    let rows: Row[];
    let complete = true;
    if (path === "/bom-stocks") rows = Object.entries(source).map(([bomCode, stockQty]) => ({ bomCode, stockQty }));
    else if (Array.isArray(raw)) rows = raw.map(object);
    else if (Array.isArray(source.items)) {
        rows = source.items.map(object);
        complete = !source.nextCursor && !(typeof source.total === "number" && source.total > rows.length);
    } else if (Array.isArray(source.flows)) rows = source.flows.map(object);
    else if (Array.isArray(source.nodes)) {
        return fit({
            asOf: source.asOf,
            summary: source.summary,
            summaryComplete: true,
            counts: source.counts,
            records: source.nodes.map(object),
            recordCount: source.nodes.length,
        });
    } else return fit({ data: source, summaryComplete: false, records: [], recordCount: 0 });
    rows = rows.filter(row => matches(path, row, filters));
    const valid = rows.filter(row => !voided(row));
    const summary: Row = {
        recordCount: rows.length,
        validRecordCount: valid.length,
        voidedRecordCount: rows.length - valid.length,
    };
    if (["/inbound", "/outbound"].includes(path)) {
        const units = new Set(rows.map(row => String(row.unit ?? "")));
        summary.unitsVerified = !units.has("");
        if (units.size === 1 && !units.has("")) summary.unit = [...units][0];
        if (units.size <= 1) {
            summary[path === "/inbound" ? "inboundQty" : "outboundQty"] = valid.reduce(
                (sum, row) => sum + number(row.qty),
                0,
            );
        }
        const byUnit = new Map<string, number>();
        for (const row of valid) {
            const unit = String(row.unit ?? "未提供单位");
            byUnit.set(unit, (byUnit.get(unit) ?? 0) + number(row.qty));
        }
        summary.quantitiesByUnit = [...byUnit].map(([unit, qty]) => ({ unit, qty }));
        summary.note = "作废记录不计入实际数量；没有仍生效的发货，不等于从未登记过发货。单位不同须分别列数量。";
    } else if (path === "/stock-adjustments")
        summary.adjustmentQty = rows.reduce((sum, row) => sum + number(row.qtyDelta), 0);
    else if (path === "/orders") {
        summary.orderQty = rows.reduce((sum, row) => sum + number(row.qty), 0);
        summary.unshippedQty = rows
            .filter(row => row.lifecycleStatus !== "archived")
            .reduce((sum, row) => sum + Math.max(0, number(row.qty) - number(row.outbound)), 0);
    }
    const groups = new Map<string, { bomCode: string; unit?: string; recordCount: number; qty: number }>();
    for (const row of valid) {
        if (typeof row.bomCode !== "string" || (typeof row.qty !== "number" && typeof row.qtyDelta !== "number"))
            continue;
        const group = groups.get(row.bomCode) ?? {
            bomCode: row.bomCode,
            ...(typeof row.unit === "string" ? { unit: row.unit } : {}),
            recordCount: 0,
            qty: 0,
        };
        group.recordCount++;
        group.qty += number(row.qtyDelta ?? row.qty);
        groups.set(row.bomCode, group);
    }
    return fit({
        scope: filters,
        summaryComplete: complete,
        summary,
        byProduct: [...groups.values()],
        ...(source.stockQty !== undefined ? { stockQty: source.stockQty, bomCode: source.bomCode } : {}),
        records: rows,
        recordCount: rows.length,
        ...(complete ? {} : { note: "还有记录未核对，只能说明当前已取得的部分；请缩小查询范围，不能当作完整合计。" }),
    });
}

function compact(value: unknown, depth = 0): unknown {
    if (typeof value === "string") return value.length > 600 ? value.slice(0, 600) + "…" : value;
    if (Array.isArray(value)) return value.map(item => compact(item, depth + 1));
    if (!value || typeof value !== "object") return value;
    if (depth > 4) return "详见对应单据";
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !["version", "rowVersion", "edges"].includes(key))
            .map(([key, item]) => [key, compact(item, depth + 1)]),
    );
}

function fit(input: Row & { records?: unknown[] }): Row {
    const preview = { ...input };
    for (const key of ["records", "byProduct", "products", "orders"]) {
        if (Array.isArray(preview[key])) preview[key] = preview[key].slice(0, 30);
    }
    const result = compact(preview) as Row & { records: unknown[]; byProduct?: unknown[] };
    result.records ??= [];
    while (JSON.stringify(result).length > MAX_RESULT_CHARS && result.records.length) result.records.pop();
    while (JSON.stringify(result).length > MAX_RESULT_CHARS && result.byProduct?.length) result.byProduct.pop();
    result.shownRecordCount = result.records.length;
    result.detailsOmitted = number(input.recordCount) > result.records.length;
    if (Array.isArray(input.byProduct))
        result.productGroupsOmitted = input.byProduct.length > (result.byProduct?.length ?? 0);
    if (Array.isArray(input.products))
        result.productsOmitted = input.products.length > (result.products as unknown[]).length;
    if (Array.isArray(input.orders)) result.ordersOmitted = input.orders.length > (result.orders as unknown[]).length;
    // 未知对象也不能撑爆单条工具消息；明确失败而非剪断业务事实。
    if (JSON.stringify(result).length > MAX_RESULT_CHARS)
        return { summaryComplete: false, note: "查询范围过大，请按日期、成品或订单缩小范围。" };
    return result;
}
