import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { useApp, type Role } from "../../context/AppContext";
import { num } from "../../lib/format";
import { KpiCard } from "../../components/ui/KpiCard";
import { PageHeading } from "../../components/ui/PageHeading";
import { Button } from "../../components/ui/Badge";
import { EChart } from "../../components/charts/EChart";
import { buildDailyTrendOption, buildPendingVsStockOption } from "../../components/charts/options";
import { CustomerCell, DateCell, LogCell, QtyCell } from "../../components/ui/cells";
import {
  dailyTrend,
  pendingVsStock,
  readyToShip,
  recentInbound,
  recentOutbound,
  riskOrders,
  statusCounts,
  stockGapBoms,
  store,
  topCustomers,
} from "../../data/store";
import { GapDialog, LedgerDialog, NoteDialog, OrderInfoDialog } from "./dialogs";
import type { PendingVsStockRow } from "../../data/types";

type Cell =
  | { type: "customer"; name: string; sub?: string }
  | { type: "text"; text: string; sub?: string }
  | { type: "date"; date: string; overdue?: boolean; badgeOnly?: boolean }
  | { type: "qty"; value: number; unit?: string; danger?: boolean }
  | { type: "bom"; text: string; sub?: string }
  | { type: "log"; main: string; sub: string };

interface WbRow {
  key: string;
  cells: Cell[];
  search: string;
  tags: string[];
}

interface WbSection {
  id: string;
  kind: "table" | "flow" | "chart";
  title: string;
  subtitle?: string;
  hero?: boolean;
  span: 5 | 6 | 7 | 12;
  columns?: string[];
  aligns?: boolean[];
  rows?: WbRow[];
  filters?: string[];
  flow?: Array<{ title: string; owner: string }>;
  chart?: "pendingVsStock" | "dailyTrend";
  chartLimit?: number;
  chartHeight?: number;
}

interface WbKpi {
  label: string;
  value: number;
  unit: string;
  hint?: string;
  tone?: "cyan" | "amber" | "danger";
  ledger?: "inbound" | "outbound" | "gap";
}

function renderCell(cell: Cell, index: number) {
  switch (cell.type) {
    case "customer":
      return <CustomerCell key={index} name={cell.name} sub={cell.sub} />;
    case "text":
      return (
        <div key={index} className="min-w-0">
          <div className="truncate text-[13px] text-td">{cell.text}</div>
          {cell.sub && <div className="mt-0.5 truncate text-[11.5px] text-[#475467]">{cell.sub}</div>}
        </div>
      );
    case "date":
      if (cell.badgeOnly) {
        return cell.overdue ? (
          <span key={index} className="inline-flex items-center rounded-full border border-[#fedf89] bg-[#fff6e7] px-2.5 py-[3px] text-[12px] font-medium whitespace-nowrap text-[#a15c07]">
            已逾期
          </span>
        ) : (
          <span key={index} className="tnum text-[13px] text-td">{cell.date}</span>
        );
      }
      return <DateCell key={index} date={cell.date} overdue={cell.overdue} />;
    case "qty":
      return <QtyCell key={index} value={cell.value} unit={cell.unit} danger={cell.danger} />;
    case "bom":
      return (
        <div key={index} className="min-w-0">
          <div className="tnum truncate text-[13px] font-semibold text-ink">{cell.text}</div>
          {cell.sub && <div className="mt-0.5 truncate text-[11.5px] text-muted">{cell.sub}</div>}
        </div>
      );
    case "log":
      return <LogCell key={index} main={cell.main} sub={cell.sub} />;
  }
}

const SPAN_CLASS: Record<number, string> = {
  5: "lg:col-span-5",
  6: "lg:col-span-6",
  7: "lg:col-span-7",
  12: "lg:col-span-12",
};

function SectionCard({ section, children }: { section: WbSection; children: React.ReactNode }) {
  return (
    <section
      className={`overflow-hidden rounded-panel border bg-white/[.97] shadow-card ${SPAN_CLASS[section.span]} ${
        section.hero ? "border-primary-border" : "border-line"
      }`}
    >
      <div className={`border-b border-line px-5 py-4 ${section.hero ? "bg-gradient-to-r from-[#f7f7ff] to-white" : ""}`}>
        <div className="flex items-center gap-2">
          {section.hero && <span className="h-4 w-[3px] rounded-full bg-primary" />}
          <h2 className={`text-[15px] font-semibold ${section.hero ? "text-primary-strong" : "text-ink"}`}>{section.title}</h2>
        </div>
        {section.subtitle && <p className="mt-0.5 text-[12px] text-muted">{section.subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function FilterChips({ filters, active, onPick }: { filters: string[]; active: string; onPick: (value: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.map((filter) => (
        <button
          key={filter}
          type="button"
          onClick={() => onPick(filter)}
          className={`h-[30px] rounded-full border px-3 text-[12px] font-medium transition ${
            filter === active
              ? "border-primary bg-primary-soft text-primary-strong"
              : "border-line bg-white text-muted hover:border-primary-border hover:text-primary"
          }`}
        >
          {filter}
        </button>
      ))}
    </div>
  );
}

const HEADINGS: Record<Role, { title: string; subtitle: string; primary: { text: string; icon: string; to: string }; secondary: Array<{ text: string; icon: string; to: string }> }> = {
  admin: {
    title: "业务管理工作台",
    subtitle: "先处理交付风险，再维护客户、BOM 与订单；关键变更全程留痕。",
    primary: { text: "新建销售订单", icon: "plus", to: "/orders?new=order" },
    secondary: [
      { text: "新建客户档案", icon: "users", to: "/customers?new=customer" },
      { text: "新建 BOM", icon: "layers", to: "/bom?new=bom" },
    ],
  },
  sales: {
    title: "销售工作台",
    subtitle: "先处理影响客户交付的订单，再跟进客户与新需求。",
    primary: { text: "新建销售订单", icon: "plus", to: "/orders?new=order" },
    secondary: [{ text: "新建客户", icon: "users", to: "/customers?new=customer" }],
  },
  warehouse: {
    title: "仓管工作台",
    subtitle: "优先完成检验合格品入库和有库存订单发货；数量更正必须填写原因。",
    primary: { text: "检验成品入库", icon: "inbound", to: "/inbound?new=inbound" },
    secondary: [{ text: "登记发货", icon: "truck", to: "/outbound?new=outbound" }],
  },
};

export function WorkbenchPage() {
  const params = useParams();
  const navigate = useNavigate();
  const { globalSearch } = useApp();
  const [note, setNote] = useState<{ title: string; description: string } | null>(null);
  const [ledger, setLedger] = useState<"inbound" | "outbound" | null>(null);
  const [gapOpen, setGapOpen] = useState(false);
  const [orderInfo, setOrderInfo] = useState<PendingVsStockRow | null>(null);
  const [sectionFilters, setSectionFilters] = useState<Record<string, string>>({});

  const roleValid = ["admin", "sales", "warehouse"].includes(params.role || "");
  const role = (roleValid ? params.role : "admin") as Role;
  const heading = HEADINGS[role];

  // ---- 数据派生（store 为模块级单例，查询失效后随组件重渲染取新值） ----
  const counts = statusCounts();
  const todayIn = store.inboundLedger.filter((row) => row.date === "2026-09-07");
  const todayOut = store.outboundLedger.filter((row) => row.date === "2026-09-07");
  const kpis: WbKpi[] =
    role === "admin"
      ? [
          { label: "今日入库", value: todayIn.length, unit: "笔", hint: `共 ${num(todayIn.reduce((s, r) => s + r.qty, 0))} 件`, ledger: "inbound" },
          { label: "今日出库", value: todayOut.length, unit: "笔", hint: `共 ${num(todayOut.reduce((s, r) => s + r.qty, 0))} 件`, ledger: "outbound" },
          { label: "可发货订单", value: counts.ready, unit: "单", tone: "cyan" },
          { label: "待备货订单", value: counts.pending, unit: "单", tone: "amber" },
          { label: "库存缺口 BOM", value: stockGapBoms(), unit: "款", tone: "danger", ledger: "gap" },
        ]
      : role === "sales"
        ? [
            { label: "全部订单", value: counts.total, unit: "单" },
            { label: "有库存可发", value: counts.ready, unit: "单", tone: "cyan" },
            { label: "待备货", value: counts.pending, unit: "单", tone: "amber" },
            { label: "缺口 BOM", value: stockGapBoms(), unit: "款", tone: "danger", ledger: "gap" },
          ]
        : [
            { label: "今日入库", value: todayIn.length, unit: "笔", hint: `共 ${num(todayIn.reduce((s, r) => s + r.qty, 0))} 件`, ledger: "inbound" },
            { label: "今日出库", value: todayOut.length, unit: "笔", hint: `共 ${num(todayOut.reduce((s, r) => s + r.qty, 0))} 件`, ledger: "outbound" },
            { label: "可发货订单", value: counts.ready, unit: "单", tone: "cyan" },
            { label: "库存缺口", value: stockGapBoms(), unit: "款", tone: "danger", ledger: "gap" },
          ];

  const riskRows = (limit: number, linkText: string): WbRow[] =>
    riskOrders(limit).map((row) => ({
      key: row.orderNo,
      search: `${row.orderNo} ${row.customer} ${row.productCode}`,
      tags: [row.overdue ? "已逾期" : "", "库存不足"].filter(Boolean),
      cells: [
        { type: "customer", name: row.customer, sub: row.orderNo },
        { type: "date", date: row.deliverDate, overdue: row.overdue, badgeOnly: row.overdue },
        { type: "bom", text: row.productCode, sub: row.bomLabel },
        { type: "qty", value: row.remaining },
        { type: "qty", value: row.maxShip, danger: true },
        { type: "text", text: linkText },
      ],
    }));

  const sections: WbSection[] =
    role === "admin"
      ? [
          {
            id: "priorityTasks",
            kind: "table",
            title: "今天优先处理",
            subtitle: "按交期与库存缺口排序，先处理会影响交付的事项",
            hero: true,
            span: 12,
            columns: ["客户 / 订单", "交期", "成品 / BOM", "待交", "当前可发", "下一步"],
            aligns: [false, false, false, true, true, true],
            filters: ["全部", "已逾期", "库存不足"],
            rows: riskRows(6, "处理订单"),
          },
          {
            id: "businessFlow",
            kind: "flow",
            title: "业务闭环",
            subtitle: "每一步沿用前序主数据，出入库更正形成审计记录",
            span: 12,
            flow: [
              { title: "客户建档", owner: "管理员 / 销售" },
              { title: "建立 BOM", owner: "管理员" },
              { title: "销售下单", owner: "管理员 / 销售" },
              { title: "查看生产要求", owner: "生产人员" },
              { title: "检验入库", owner: "仓管" },
              { title: "订单出库", owner: "仓管" },
            ],
          },
          { id: "pendingChart", kind: "chart", title: "待交付订单", hero: true, span: 7, chart: "pendingVsStock", chartLimit: 8, chartHeight: 400 },
          { id: "trend", kind: "chart", title: "近 30 天下单与出库", span: 5, chart: "dailyTrend", chartHeight: 400 },
        ]
      : role === "sales"
        ? [
            {
              id: "salesPriority",
              kind: "table",
              title: "需要跟进的交付",
              subtitle: "已逾期与库存不足的订单置顶",
              hero: true,
              span: 12,
              columns: ["客户 / 订单", "交期", "成品", "待交", "可发", "操作"],
              aligns: [false, false, false, true, true, true],
              filters: ["全部", "已逾期", "库存不足"],
              rows: riskRows(6, "查看订单"),
            },
            { id: "salesPending", kind: "chart", title: "待交付订单与可用库存", span: 7, chart: "pendingVsStock", chartLimit: 7, chartHeight: 340 },
            {
              id: "customerFocus",
              kind: "table",
              title: "重点客户",
              subtitle: "按累计下单数量排序",
              span: 5,
              columns: ["客户", "订单", "待交"],
              aligns: [false, true, true],
              rows: topCustomers(6).map((row) => ({
                key: row.customerCode,
                search: `${row.customer} ${row.customerCode}`,
                tags: [],
                cells: [
                  { type: "customer", name: row.customer, sub: row.customerCode },
                  { type: "qty", value: row.orderCount, unit: "单" },
                  { type: "qty", value: row.pendingQty, unit: "件" },
                ],
              })),
            },
          ]
        : [
            {
              id: "shipNow",
              kind: "table",
              title: "现在可以发货",
              subtitle: "库存已按交期从近到远预占，避免同一库存重复承诺",
              hero: true,
              span: 12,
              columns: ["客户 / 订单", "交期", "成品", "待交", "本次可发", "操作"],
              aligns: [false, false, false, true, true, true],
              filters: ["全部", "已逾期", "可全部发", "可部分发"],
              rows: readyToShip()
                .slice(0, 6)
                .map((row) => ({
                  key: row.orderNo,
                  search: `${row.orderNo} ${row.customer} ${row.productCode}`,
                  tags: [row.overdue ? "已逾期" : "", row.maxShip >= row.remaining ? "可全部发" : row.maxShip > 0 ? "可部分发" : ""].filter(Boolean),
                  cells: [
                    { type: "customer", name: row.customer, sub: row.orderNo },
                    { type: "date", date: row.deliverDate, overdue: row.overdue, badgeOnly: row.overdue },
                    { type: "bom", text: row.productCode, sub: row.bomLabel },
                    { type: "qty", value: row.remaining },
                    { type: "qty", value: row.maxShip, danger: row.maxShip <= 0 },
                    { type: "text", text: "登记发货" },
                  ],
                })),
            },
            {
              id: "recentInbound",
              kind: "table",
              title: "最近入库",
              span: 6,
              columns: ["入库单", "日期", "数量"],
              aligns: [false, false, true],
              rows: recentInbound(5).map((row) => ({
                key: row.no,
                search: `${row.no} ${row.productCode}`,
                tags: [],
                cells: [
                  { type: "customer", name: row.no, sub: row.productCode },
                  { type: "date", date: row.date },
                  { type: "qty", value: row.qty, unit: "件" },
                ],
              })),
            },
            {
              id: "recentOutbound",
              kind: "table",
              title: "最近出库",
              span: 6,
              columns: ["出库单 / 订单", "客户", "数量"],
              aligns: [false, false, true],
              rows: recentOutbound(5).map((row) => ({
                key: row.no,
                search: `${row.no} ${row.orderNo} ${row.customer}`,
                tags: [],
                cells: [
                  { type: "customer", name: row.no, sub: row.orderNo },
                  { type: "text", text: row.customer },
                  { type: "qty", value: row.qty, unit: "件" },
                ],
              })),
            },
            {
              id: "operationLog",
              kind: "table",
              title: "操作与变更记录",
              subtitle: "保留操作人、时间与业务对象，记录不可删除",
              span: 12,
              columns: ["时间", "操作人", "动作", "对象"],
              rows: store.opLog.slice(0, 8).map((row, index) => ({
                key: `${row.target}-${index}`,
                search: `${row.user} ${row.action} ${row.target}`,
                tags: [],
                cells: [
                  { type: "log", main: row.date, sub: row.time },
                  { type: "log", main: row.user, sub: row.role },
                  { type: "text", text: row.action },
                  { type: "log", main: row.target, sub: "" },
                ],
              })),
            },
          ];

  const keyword = globalSearch.trim().toLowerCase();
  const renderedSections = sections.map((section) => {
    const activeFilter = sectionFilters[section.id] || "全部";
    let rows = section.rows || [];
    if (activeFilter !== "全部") rows = rows.filter((row) => row.tags.includes(activeFilter));
    if (keyword) rows = rows.filter((row) => row.search.toLowerCase().includes(keyword));
    return { section, rows, activeFilter, total: (section.rows || []).length };
  });

  if (!roleValid) return <Navigate to="/workbench/admin" replace />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        eyebrow="角色工作区"
        title={heading.title}
        description={heading.subtitle}
        actions={
          <>
            {heading.secondary.map((action) => (
              <Button key={action.text} variant="secondary" icon={action.icon} onClick={() => navigate(action.to)}>
                {action.text}
              </Button>
            ))}
            <Button icon={heading.primary.icon} onClick={() => navigate(heading.primary.to)}>
              {heading.primary.text}
            </Button>
          </>
        }
      />

      <div className={`grid grid-cols-2 gap-2.5 ${role === "admin" ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        {kpis.map((kpi) => (
          <KpiCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            unit={kpi.unit}
            hint={kpi.hint}
            tone={kpi.tone}
            onClick={() => {
              if (kpi.ledger === "gap") setGapOpen(true);
              else if (kpi.ledger) setLedger(kpi.ledger);
            }}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
        {renderedSections.map(({ section, rows, activeFilter, total }) => {
          if (section.kind === "flow") {
            return (
              <SectionCard key={section.id} section={section}>
                <ol className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-6">
                  {section.flow!.map((step, index) => (
                    <li key={step.title} className="rounded-[12px] border border-line/80 bg-[#fcfcfd] px-3 py-3">
                      <span className="tnum text-[11px] font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span>
                      <strong className="mt-0.5 block text-[13px] font-semibold text-ink">{step.title}</strong>
                      <small className="mt-0.5 block text-[11.5px] text-muted">{step.owner}</small>
                    </li>
                  ))}
                </ol>
              </SectionCard>
            );
          }
          if (section.kind === "chart") {
            const chartRows =
              section.chart === "pendingVsStock"
                ? pendingVsStock(section.chartLimit ?? 8).filter((row) => !keyword || `${row.id} ${row.customer} ${row.productCode}`.toLowerCase().includes(keyword))
                : [];
            return (
              <SectionCard key={section.id} section={section}>
                <div className="px-4 pt-3 pb-4">
                  {section.chart === "pendingVsStock" ? (
                    <EChart
                      option={buildPendingVsStockOption(chartRows)}
                      height={section.chartHeight ?? 400}
                      onClick={(params) => {
                        const row = pendingVsStock(section.chartLimit ?? 8).find((item) => item.id === params.name);
                        if (row) setOrderInfo(row);
                      }}
                    />
                  ) : (
                    <EChart option={buildDailyTrendOption(dailyTrend(30))} height={section.chartHeight ?? 400} />
                  )}
                  {section.chart === "pendingVsStock" && chartRows.length === 0 && (
                    <p className="pb-2 text-center text-[13px] text-[#8a9188]">没有匹配的订单，请调整搜索词</p>
                  )}
                </div>
              </SectionCard>
            );
          }
          const lastLinkText = section.rows?.[0]?.cells.at(-1)?.type === "text" ? (section.rows[0].cells.at(-1) as { text: string }).text : "";
          return (
            <SectionCard key={section.id} section={section}>
              {section.filters && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <FilterChips
                    filters={section.filters}
                    active={activeFilter}
                    onPick={(value) => setSectionFilters((prev) => ({ ...prev, [section.id]: value }))}
                  />
                  <span className="text-[12px] text-subtle">
                    共 {total} 条{rows.length !== total ? ` · 找到 ${rows.length} 条匹配` : ""}
                  </span>
                </div>
              )}
              <div className="overflow-x-auto px-1.5 pb-2">
                <table className="w-full min-w-[640px] border-collapse">
                  <thead>
                    <tr className="bg-[#f8fafc] text-left">
                      {section.columns!.map((column, columnIndex) => (
                        <th
                          key={column}
                          className={`px-3.5 py-2.5 text-[12px] font-semibold whitespace-nowrap text-muted ${section.aligns?.[columnIndex] ? "text-right" : ""}`}
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={section.columns!.length} className="px-4 py-8 text-center text-[13px] text-subtle">
                          没有匹配的记录，请调整搜索或筛选条件。
                        </td>
                      </tr>
                    )}
                    {rows.map((row) => (
                      <tr key={row.key} className="border-t border-line/70 transition hover:bg-row-hover">
                        {row.cells.map((cell, index) => (
                          <td key={index} className={`px-3.5 py-3 align-middle ${section.aligns?.[index] ? "text-right" : ""}`}>
                            {cell.type === "text" && cell.text === lastLinkText && lastLinkText ? (
                              <button
                                type="button"
                                onClick={() => navigate(section.id === "shipNow" ? "/outbound" : "/orders")}
                                className="text-[13px] font-medium text-primary-strong underline-offset-2 transition hover:underline"
                              >
                                {cell.text}
                              </button>
                            ) : (
                              renderCell(cell, index)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          );
        })}
      </div>

      <LedgerDialog open={ledger !== null} kind={ledger ?? "inbound"} onClose={() => setLedger(null)} />
      <GapDialog open={gapOpen} onClose={() => setGapOpen(false)} />
      <OrderInfoDialog order={orderInfo} onClose={() => setOrderInfo(null)} />
      <NoteDialog note={note} onClose={() => setNote(null)} />
    </div>
  );
}
