/* 独立讨论原型：不读取凭据，不连接业务接口。 */
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = text =>
    String(text).replace(
        /[&<>"']/g,
        char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
    );
const paths = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    inbound: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5M12 13v9M12 3v6m-3-3 3 3 3-3"/>',
    outbound: '<path d="M3 6h11v12H3zM14 10h4l3 4v4h-7M5 18a2 2 0 1 0 4 0m7 0a2 2 0 1 0 4 0"/>',
    orders: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    settings:
        '<path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h9m4 0h3"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="18" r="2"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
    fit: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5v14m8-14v14"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
};
const icon = name =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.orders}</svg>`;
const icons = () =>
    $$("[data-icon]").forEach(el => {
        el.innerHTML = icon(el.dataset.icon);
    });
const fmt = n => n.toLocaleString("en-US");
const products = [
    {
        bom: "XK2006",
        name: "旋转XK2",
        spec: "型号 0-3 · 规格 263-1-A · 方向 正面反轴",
        model: "0-3",
        size: "263-1-A",
        direction: "正面反轴",
        materials: 10,
    },
    {
        bom: "XK2007",
        name: "旋转XK2",
        spec: "型号 4-2 · 规格 243-1-2 · 方向 正面",
        model: "4-2",
        size: "243-1-2",
        direction: "正面",
        materials: 10,
    },
    {
        bom: "KW001",
        name: "新微动",
        spec: "底座 二脚底座（无挡脚）· 按钮 8.3mm · 触点 银",
        model: "二脚底座（无挡脚）",
        size: "8.3mm",
        direction: "银触点",
        materials: 11,
    },
    {
        bom: "XK2005",
        name: "旋转XK2",
        spec: "型号 3-1 · 规格 233-4 · 方向 正面",
        model: "3-1",
        size: "233-4",
        direction: "正面",
        materials: 10,
    },
];
const quantities = [7600, 4000, 6800, 1600, 5050, 10000, 3200, 4800, 7200, 2600, 8400, 6000];
const customers = ["华信电器", "嘉禾机电", "恒达电子", "安泰电气"];
const records = quantities.map((qty, i) => ({
    ...products[i % 4],
    i,
    qty,
    date: `2026-09-${19 - Math.floor(i / 4)}`,
    person: i % 3 === 0 ? "郭均" : "吉英",
    customer: customers[i % 4],
    sent: i % 3 === 0 ? 0 : i % 3 === 1 ? Math.floor(qty / 2) : qty,
    status: ["待发货", "部分发货", "已完成"][i % 3],
}));
const configs = {
    inbound: {
        title: "成品入库",
        subtitle: "核对成品规格与数量，追溯每一笔入库。",
        action: "检验入库",
        prefix: "RK",
        date: "入库日期",
        qty: "入库数量",
        person: "检验登记人",
        detail: "入库凭证",
        search: "搜索单号、BOM 编码、登记人",
        cols: [
            ["id", "入库单号", 166],
            ["bom", "BOM 编码 / 产品信息", 370],
            ["qty", "入库数量（个）", 132],
            ["date", "入库日期", 138],
            ["person", "检验登记人", 130],
            ["action", "操作", 120],
        ],
    },
    outbound: {
        title: "成品出库",
        subtitle: "按订单核对发货，客户、成品与数量清晰对应。",
        action: "登记发货",
        prefix: "CK",
        date: "出库日期",
        qty: "出库数量",
        person: "操作人",
        detail: "出库凭证",
        search: "搜索单号、BOM 编码、客户",
        cols: [
            ["id", "出库单号", 158],
            ["customer", "订单 / 客户", 168],
            ["bom", "BOM 编码 / 产品信息", 350],
            ["qty", "出库数量（个）", 125],
            ["date", "出库日期", 130],
            ["person", "操作人", 100],
            ["status", "状态", 100],
            ["action", "操作", 128],
        ],
    },
    orders: {
        title: "销售订单",
        subtitle: "先看待交数量，再安排每一笔发货。",
        action: "新建订单",
        prefix: "XS",
        date: "交货日期",
        qty: "订单数量",
        detail: "订单详情",
        search: "搜索订单号、BOM 编码、客户",
        cols: [
            ["id", "销售订单号", 154],
            ["customer", "客户", 150],
            ["bom", "成品 / BOM", 350],
            ["qty", "订单数量（个）", 130],
            ["date", "交货日期", 130],
            ["delivery", "交付情况", 138],
            ["status", "状态", 105],
            ["action", "操作", 124],
        ],
    },
};
let view = "inbound",
    page = 1,
    pageSize = 8,
    sort = { key: "date", dir: -1 },
    filters = { date: "", person: "", status: "" },
    prefs = {};
let lastFocus = null,
    toastTimer,
    drag = null;
function readPrefs() {
    try {
        return JSON.parse(localStorage.getItem(`table-prototype:${view}`)) || {};
    } catch {
        return {};
    }
}
function savePrefs() {
    try {
        localStorage.setItem(`table-prototype:${view}`, JSON.stringify(prefs));
    } catch {}
}
function number(r) {
    return `${configs[view].prefix}${r.date.slice(2).replaceAll("-", "")}${String(r.i + 1).padStart(2, "0")}`;
}
function dateOf(r) {
    return view === "orders" ? `2026-09-${22 + (r.i % 6)}` : r.date;
}
function statusOf(r) {
    return view === "outbound" ? "已出库" : r.status;
}
function badge(r) {
    const text = statusOf(r);
    return `<span class="badge ${text === "待发货" ? "pending" : text === "部分发货" ? "partial" : ""}">${text}</span>`;
}
function toast(message) {
    $("#toast").textContent = message;
    $("#toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("#toast").hidden = true), 3300);
}
function openDialog(id) {
    lastFocus = document.activeElement;
    $(id).showModal();
}
function columns() {
    return configs[view].cols.filter(([key]) => !prefs.hidden?.includes(key) || ["id", "action"].includes(key));
}
function rows() {
    const q = $("#search").value.trim().toLowerCase();
    const items = records.filter(
        r =>
            [number(r), r.bom, r.name, r.person, r.customer].join(" ").toLowerCase().includes(q) &&
            (!$("#category").value || r.name === $("#category").value) &&
            (!filters.person || r.person === filters.person) &&
            (!filters.status || statusOf(r) === filters.status) &&
            (!filters.date || (filters.date === "today" ? r.date === "2026-09-19" : r.date >= "2026-09-18")),
    );
    return items.sort((a, b) => {
        const av = sort.key === "date" ? dateOf(a) : sort.key === "qty" ? a.qty : number(a);
        const bv = sort.key === "date" ? dateOf(b) : sort.key === "qty" ? b.qty : number(b);
        return typeof av === "number" ? (av - bv) * sort.dir : String(av).localeCompare(String(bv)) * sort.dir;
    });
}
function product(r) {
    return `<div class="bom-title"><button class="link code" data-detail="${r.i}" data-product="true" aria-label="查看 ${r.bom} 的完整规格与物料">${r.bom}</button><span class="product-name">${r.name}</span></div><span class="spec" title="${r.spec}">${r.spec}</span><button class="link spec-detail" data-detail="${r.i}" data-product="true">查看物料（${r.materials}）</button>`;
}
function cell(key, r) {
    if (key === "id") return `<button class="link code record-link" data-detail="${r.i}">${number(r)}</button>`;
    if (key === "bom") return product(r);
    if (key === "qty") return `<span class="amount">${fmt(r.qty)}</span>`;
    if (key === "date") return dateOf(r);
    if (key === "person") return r.person;
    if (key === "customer")
        return `${r.customer}${view === "outbound" ? `<span class="spec">XS260916${String(r.i + 1).padStart(2, "0")}</span>` : ""}`;
    if (key === "status") return badge(r);
    if (key === "delivery")
        return `<span>待交 <strong>${fmt(r.qty - r.sent)}</strong></span><span class="spec">已发 ${fmt(r.sent)} / ${fmt(r.qty)}</span><div class="progress-track"><i style="width:${(r.sent / r.qty) * 100}%"></i></div>`;
    return `<button class="link" data-detail="${r.i}">${view === "orders" ? "查看详情" : "查看凭证"} <span aria-hidden="true">↗</span></button>`;
}
function mobileCard(r) {
    const hidden = new Set(prefs.hidden || []),
        show = key => !hidden.has(key);
    return `<article class="record-card"><div class="card-head"><button class="link code record-link" data-detail="${r.i}">${number(r)}</button>${view === "orders" && show("status") ? badge(r) : show("date") ? `<time>${dateOf(r)}</time>` : ""}</div><div class="card-product">${view !== "inbound" && show("customer") ? `<div class="customer-line">${r.customer}${view === "outbound" ? " · 对应订单 XS260916" + String(r.i + 1).padStart(2, "0") : ""}</div>` : ""}${show("bom") ? product(r) : ""}</div><div class="card-facts">${show("qty") ? `<div><small>${configs[view].qty}</small><span class="amount">${fmt(r.qty)}<span class="unit">个</span></span></div>` : ""}${view === "orders" ? (show("delivery") ? `<div><small>待交数量</small><span class="amount" style="color:var(--primary-dark)">${fmt(r.qty - r.sent)}<span class="unit">个</span></span></div>` : "") : show("person") ? `<div><small>${configs[view].person}</small><span class="person">${r.person}</span></div>` : ""}</div><div class="card-footer"><span class="help">${view === "orders" && show("date") ? "交期 " + dateOf(r) : view === "outbound" && show("status") ? "已出库" : "可查看完整凭证"}</span><button class="link" data-detail="${r.i}">${view === "orders" ? "订单详情" : "查看凭证"} <span aria-hidden="true">→</span></button>${view === "orders" && r.sent < r.qty ? `<button class="secondary" data-ship="${r.i}">登记发货</button>` : ""}</div></article>`;
}
function widths() {
    const cols = columns();
    const map = Object.fromEntries(cols.map(([key, , width]) => [key, prefs.widths?.[key] || width]));
    const spare = $("#table-scroll").clientWidth - Object.values(map).reduce((a, b) => a + b, 0);
    if (spare > 0 && !Object.keys(prefs.widths || {}).length) {
        const key = map.bom ? "bom" : cols.find(([k]) => !["id", "action"].includes(k))?.[0];
        if (key) map[key] += spare;
    }
    return map;
}
function applyWidths(map = widths()) {
    $$("#data-table col").forEach(col => (col.style.width = map[col.dataset.key] + "px"));
    $("#data-table").style.width = Object.values(map).reduce((a, b) => a + b, 0) + "px";
    $$(".resizer").forEach(el => el.setAttribute("aria-valuenow", Math.round(map[el.dataset.key])));
    const overflow = $("#table-scroll").scrollWidth > $("#table-scroll").clientWidth + 2;
    $("#table-hint").textContent = overflow
        ? "向右滚动查看更多内容，单号和操作始终可见。点击“适合屏幕”恢复推荐布局。"
        : "拖动表头右边界调整列宽；高亮区域就是正在调整的列。双击边界可恢复推荐宽度。";
}
function render() {
    const data = rows(),
        totalPages = Math.max(1, Math.ceil(data.length / pageSize));
    page = Math.min(page, totalPages);
    const paged = data.slice((page - 1) * pageSize, page * pageSize),
        cols = columns();
    document.body.classList.remove("compact", "roomy");
    if (prefs.density) document.body.classList.add(prefs.density);
    $("#data-table").innerHTML =
        `<caption class="sr-only">${configs[view].title}记录，示例数据</caption><colgroup>${cols.map(([key]) => `<col data-key="${key}">`).join("")}</colgroup><thead><tr>${cols.map(([key, label]) => `<th scope="col" data-col="${key}" class="${key === "qty" ? "num" : ""}" ${["date", "qty", "id"].includes(key) ? `aria-sort="${sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}"` : ""}>${["date", "qty", "id"].includes(key) ? `<button class="sort-button ${sort.key === key ? "active" : ""}" data-sort="${key}">${label} <span aria-hidden="true">${sort.key === key ? (sort.dir === 1 ? "↑" : "↓") : "↕"}</span></button>` : label}${key !== "action" ? `<span class="resizer" role="separator" tabindex="0" aria-label="调整${label}列宽" aria-orientation="vertical" aria-valuemin="${key === "bom" ? 280 : 100}" aria-valuemax="800" data-key="${key}" title="调整${label}；左右键微调；双击恢复推荐"></span>` : ""}</th>`).join("")}</tr></thead><tbody>${paged.map(r => `<tr>${cols.map(([key]) => `<td data-col="${key}" class="${key === "qty" ? "num" : ""}">${cell(key, r)}</td>`).join("")}</tr>`).join("")}</tbody>`;
    $("#mobile-list").innerHTML = paged.map(mobileCard).join("");
    $("#record-count").textContent = data.length;
    $("#empty").hidden = data.length > 0;
    $("#table-scroll").hidden = data.length === 0;
    $("#mobile-list").hidden = data.length === 0;
    $("#page-summary").textContent = data.length
        ? `显示 ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, data.length)}，共 ${data.length} 条`
        : "共 0 条记录";
    $("#page-index").textContent = `${page} / ${totalPages}`;
    $("#prev").disabled = page <= 1;
    $("#next").disabled = page >= totalPages;
    const tags = [
        filters.date && (filters.date === "today" ? "日期：2026-09-19" : "日期：最近两天"),
        filters.person && "登记人：" + filters.person,
        filters.status && "状态：" + filters.status,
    ].filter(Boolean);
    $("#active-filters").hidden = !tags.length;
    $("#active-filters").innerHTML =
        tags.map(t => `<span class="filter-chip">${t}</span>`).join("") +
        (tags.length ? '<button class="text-button" data-clear-filters>清除筛选 ×</button>' : "");
    $("#filter-count").textContent = tags.length ? ` (${tags.length})` : "";
    applyWidths();
    bindResizers();
}
function setView(next) {
    view = next;
    prefs = readPrefs();
    page = 1;
    sort = { key: "date", dir: view === "orders" ? 1 : -1 };
    filters = { date: "", person: "", status: "" };
    $("#search").value = "";
    $("#category").value = "";
    $("#title").textContent = configs[view].title;
    $("#breadcrumb").textContent = configs[view].title;
    $("#subtitle").textContent = configs[view].subtitle;
    $("#create").innerHTML = icon("plus") + configs[view].action;
    $("#search").placeholder = configs[view].search;
    $("#desktop-nav").innerHTML = Object.entries(configs)
        .map(
            ([key, c]) =>
                `<button data-view="${key}" class="${key === view ? "active" : ""}" ${key === view ? 'aria-current="page"' : ""}>${icon(key)}${c.title}</button>`,
        )
        .join("");
    $("#mobile-nav").innerHTML = Object.entries(configs)
        .map(
            ([key, c]) =>
                `<button data-view="${key}" class="${key === view ? "active" : ""}" ${key === view ? 'aria-current="page"' : ""}>${icon(key)}${c.title}</button>`,
        )
        .join("");
    $("#status-label").hidden = view !== "orders";
    $("#person-label").hidden = view === "orders";
    $("#date-filter").parentElement.hidden = view === "orders";
    render();
    window.scrollTo(0, 0);
}
function highlight(key) {
    $$("#data-table [data-col]").forEach(el => el.classList.toggle("highlight", el.dataset.col === key));
}
function resizeStart(el, event) {
    if (event.button !== 0) return;
    event.preventDefault();
    el.setPointerCapture(event.pointerId);
    const key = el.dataset.key,
        map = widths(),
        label = configs[view].cols.find(c => c[0] === key)[1];
    drag = { key, map, start: event.clientX, width: map[key], el };
    highlight(key);
    document.body.classList.add("resizing");
    $("#resize-status").hidden = false;
    $("#resize-status").textContent = `正在调整「${label}」 · 其他列宽度保持不变`;
}
function resizeMove(event) {
    if (!drag) return;
    const min = drag.key === "bom" ? 280 : 100;
    drag.map[drag.key] = Math.round(Math.max(min, Math.min(800, drag.width + event.clientX - drag.start)));
    applyWidths(drag.map);
}
function resizeEnd(cancel = false) {
    if (!drag) return;
    if (!cancel) {
        prefs.widths = { ...prefs.widths, ...drag.map };
        savePrefs();
    }
    drag = null;
    document.body.classList.remove("resizing");
    highlight(null);
    $("#resize-status").hidden = true;
    applyWidths();
}
function resetColumn(key) {
    if (prefs.widths) delete prefs.widths[key];
    savePrefs();
    applyWidths();
    toast("已恢复这列的推荐宽度");
}
function bindResizers() {
    $$(".resizer").forEach(el => {
        el.onpointerdown = e => resizeStart(el, e);
        el.onpointermove = resizeMove;
        el.onpointerup = () => resizeEnd();
        el.onpointercancel = () => resizeEnd(true);
        el.onlostpointercapture = () => resizeEnd(true);
        el.ondblclick = () => resetColumn(el.dataset.key);
        el.onmouseenter = () => {
            if (!drag) highlight(el.dataset.key);
        };
        el.onmouseleave = () => {
            if (!drag) highlight(null);
        };
        el.onfocus = () => highlight(el.dataset.key);
        el.onblur = () => {
            if (!drag) highlight(null);
        };
        el.onkeydown = e => {
            if (!["ArrowLeft", "ArrowRight", "Home"].includes(e.key)) return;
            e.preventDefault();
            const key = el.dataset.key;
            if (e.key === "Home") return resetColumn(key);
            const map = widths();
            map[key] = Math.min(
                800,
                Math.max(key === "bom" ? 280 : 100, map[key] + (e.key === "ArrowRight" ? 24 : -24)),
            );
            prefs.widths = map;
            savePrefs();
            applyWidths();
            highlight(key);
        };
    });
}
function renderSettings() {
    $("#density-options").innerHTML = [
        ["compact", "紧凑", "优先看更多记录"],
        ["standard", "标准", "同时看产品规格"],
        ["roomy", "宽松", "留出更多阅读空间"],
    ]
        .map(
            ([key, label, description]) =>
                `<button data-density="${key}" class="${(prefs.density || "standard") === key ? "selected" : ""}" aria-pressed="${(prefs.density || "standard") === key}">${label}<small>${description}</small></button>`,
        )
        .join("");
    $("#column-options").innerHTML = configs[view].cols
        .map(
            ([key, label]) =>
                `<div class="column-option"><label><input type="checkbox" data-column="${key}" ${!prefs.hidden?.includes(key) ? "checked" : ""} ${["id", "action"].includes(key) ? "disabled" : ""}>${label.replace(" / 产品信息", "")}</label>${key === "action" ? "<span>始终显示</span>" : `<select aria-label="${label}的宽窄" data-column-width="${key}"><option value="recommended">推荐宽度</option><option value="narrow">窄一些</option><option value="wide">宽一些</option>${prefs.widths?.[key] ? '<option value="custom" selected>已手动调整</option>' : ""}</select>`}</div>`,
        )
        .join("");
}
function detail(index, productOnly = false) {
    const r = records[index];
    $("#detail-kicker").textContent = productOnly ? "成品档案 · 示例" : configs[view].detail;
    $("#detail-title").textContent = productOnly ? r.bom : number(r);
    $("#detail-body").innerHTML =
        `<div class="detail-hero"><strong>${r.bom}</strong><span class="product-name">${r.name}</span></div><dl class="detail-grid"><div><dt>${r.name === "新微动" ? "底座" : "型号"}</dt><dd>${r.model}</dd></div><div><dt>${r.name === "新微动" ? "按钮" : "规格"}</dt><dd>${r.size}</dd></div><div><dt>${r.name === "新微动" ? "触点类别" : "方向"}</dt><dd>${r.direction}</dd></div><div><dt>品类</dt><dd>${r.name}</dd></div>${!productOnly ? `<div><dt>${configs[view].qty}</dt><dd><strong class="amount">${fmt(r.qty)}</strong> 个</dd></div><div><dt>${configs[view].date}</dt><dd>${dateOf(r)}</dd></div>${view === "inbound" ? `<div><dt>检验登记人</dt><dd>${r.person}</dd></div>` : `<div><dt>客户</dt><dd>${r.customer}</dd></div><div><dt>${view === "orders" ? "待交数量" : "操作人"}</dt><dd>${view === "orders" ? fmt(r.qty - r.sent) + " 个" : r.person}</dd></div>`}` : ""}</dl><h3>物料构成 <span class="help">· 以下为布局示意</span></h3><ul class="material-list"><li><span>底座组件</span><span>1 件</span></li><li><span>接触片</span><span>2 件</span></li><li><span>弹簧</span><span>1 件</span></li><li><span>旋钮组件</span><span>1 件</span></li></ul><p class="help">原型仅展示 4 项示例物料。正式页面将沿用现有 BOM 数据与权限。</p>${!productOnly ? `<div class="detail-actions">${view === "orders" && r.sent < r.qty ? `<button class="primary" data-ship="${r.i}">登记发货</button>` : ""}${view === "outbound" ? '<button class="secondary" data-demo="打印出库单">打印出库单</button>' : ""}<button class="secondary" data-demo="${view === "orders" ? "编辑订单" : "修正记录"}">${view === "orders" ? "编辑订单" : "修正记录"}</button></div>` : ""}`;
    if (!$("#detail-dialog").open) openDialog("#detail-dialog");
}
document.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-close")) {
        button.closest("dialog").close();
        return;
    }
    if (button.dataset.view) {
        setView(button.dataset.view);
        return;
    }
    if (button.dataset.detail !== undefined) {
        detail(+button.dataset.detail, button.dataset.product === "true");
        return;
    }
    if (button.dataset.ship !== undefined) {
        detail(+button.dataset.ship);
        toast("登记发货：原型仅展示入口，后续沿用现有发货表单。");
        return;
    }
    if (button.dataset.demo) {
        toast(`${button.dataset.demo}：此处为交互示意，不会修改业务数据。`);
        return;
    }
    if (button.dataset.sort) {
        sort = { key: button.dataset.sort, dir: sort.key === button.dataset.sort ? -sort.dir : 1 };
        page = 1;
        render();
        return;
    }
    if (button.dataset.density) {
        prefs.density = button.dataset.density;
        savePrefs();
        render();
        renderSettings();
        $(`[data-density="${prefs.density}"]`).focus();
        return;
    }
    if (button.hasAttribute("data-clear-filters")) {
        filters = { date: "", person: "", status: "" };
        page = 1;
        render();
    }
});
document.addEventListener("change", event => {
    const el = event.target;
    if (el.dataset.column) {
        prefs.hidden = prefs.hidden || [];
        prefs.hidden = el.checked
            ? prefs.hidden.filter(key => key !== el.dataset.column)
            : [...prefs.hidden, el.dataset.column];
        savePrefs();
        render();
    }
    if (el.dataset.columnWidth) {
        const key = el.dataset.columnWidth,
            base = configs[view].cols.find(c => c[0] === key)[2],
            map = widths();
        if (el.value === "recommended") {
            prefs.widths = prefs.widths || {};
            delete prefs.widths[key];
        } else if (el.value !== "custom") {
            map[key] = Math.min(
                800,
                Math.max(key === "bom" ? 280 : 100, (map[key] || base) + (el.value === "wide" ? 100 : -60)),
            );
            prefs.widths = map;
        }
        savePrefs();
        render();
    }
});
$$("dialog").forEach(dialog => {
    dialog.addEventListener("close", () => lastFocus?.isConnected && lastFocus.focus());
    dialog.addEventListener("click", e => {
        if (e.target === dialog) {
            const r = dialog.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
        }
    });
});
$("#search").oninput = () => {
    page = 1;
    render();
};
$("#category").onchange = () => {
    page = 1;
    render();
};
$("#prev").onclick = () => {
    page--;
    render();
};
$("#next").onclick = () => {
    page++;
    render();
};
$("#page-size").onchange = () => {
    pageSize = +$("#page-size").value;
    page = 1;
    render();
};
$("#fit").onclick = () => {
    prefs.widths = {};
    savePrefs();
    render();
    toast("已恢复推荐列宽，产品信息优先占用剩余空间");
};
$("#settings").onclick = () => {
    renderSettings();
    openDialog("#settings-dialog");
};
$("#reset-settings").onclick = () => {
    prefs = {};
    savePrefs();
    render();
    renderSettings();
    toast("已恢复推荐显示设置");
};
$("#guide").onclick = () => openDialog("#guide-dialog");
$("#create").onclick = () => toast(`${configs[view].action}：原型仅展示入口，后续沿用现有业务表单。`);
$("#refresh").onclick = () => {
    render();
    toast("示例记录已刷新");
};
$("#filters").onclick = () => {
    $("#date-filter").value = filters.date;
    $("#person-filter").value = filters.person;
    $("#status-filter").value = filters.status;
    openDialog("#filter-dialog");
};
$("#filter-form").onsubmit = event => {
    event.preventDefault();
    filters = {
        date: view === "orders" ? "" : $("#date-filter").value,
        person: view === "orders" ? "" : $("#person-filter").value,
        status: view === "orders" ? $("#status-filter").value : "",
    };
    page = 1;
    render();
    $("#filter-dialog").close();
};
$("#reset-filter").onclick = () => {
    $("#date-filter").value = "";
    $("#person-filter").value = "";
    $("#status-filter").value = "";
};
$("#clear-empty").onclick = () => {
    $("#search").value = "";
    $("#category").value = "";
    filters = { date: "", person: "", status: "" };
    page = 1;
    render();
};
$("#export").onclick = () => {
    const csv =
        "\uFEFF单号,BOM 编码,产品名称,数量,日期\r\n" +
        rows()
            .map(r => [number(r), r.bom, r.name, r.qty, dateOf(r)].join(","))
            .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${configs[view].title}-示例.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("已导出当前筛选结果（示例数据）");
};
$("#phone-mode").onclick = () => {
    document.body.classList.add("preview-phone");
    $("#phone-stage").hidden = false;
    $("#phone-mode").classList.add("selected");
    $("#desktop-mode").classList.remove("selected");
    $("#phone-mode").setAttribute("aria-pressed", "true");
    $("#desktop-mode").setAttribute("aria-pressed", "false");
    if (!$("#phone-frame").src) $("#phone-frame").src = "index.html?embedded=1";
};
$("#desktop-mode").onclick = () => {
    document.body.classList.remove("preview-phone");
    $("#phone-stage").hidden = true;
    $("#desktop-mode").classList.add("selected");
    $("#phone-mode").classList.remove("selected");
    $("#desktop-mode").setAttribute("aria-pressed", "true");
    $("#phone-mode").setAttribute("aria-pressed", "false");
    prefs = readPrefs();
    render();
};
if (new URLSearchParams(location.search).has("embedded")) document.body.classList.add("embedded");
new ResizeObserver(() => {
    if (!drag) applyWidths();
}).observe($("#table-scroll"));
icons();
setView("inbound");
