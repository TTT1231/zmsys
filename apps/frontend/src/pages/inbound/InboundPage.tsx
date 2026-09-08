import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { ListState, RecordCard } from "@/components/ui/MobileList";
import { SearchSelect } from "@/components/ui/SearchSelect";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "@/lib/icons";
import { downloadCsv, num } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { QtyCell } from "@/components/ui/cells";
import {
  DateField,
  SelectField,
  TextArea,
  TextField,
} from "@/components/ui/Field";
import { useCreateInbound, useWbSnapshot } from "@/data/queries";
import { EMPTY_SNAPSHOT, bomByCode } from "@/data/views";
import { todayIso } from "@/lib/date";
import { useToast } from "@/components/ui/Toast";
import type { InboundRow, Snapshot } from "@/api";

export function InboundModal({
  open,
  onClose,
  initialBomCode = "",
}: {
  open: boolean;
  onClose: () => void;
  initialBomCode?: string;
}) {
  const { data } = useWbSnapshot();
  const snap = data ?? EMPTY_SNAPSHOT;
  const createInbound = useCreateInbound();
  const toast = useToast();
  const boms = snap.boms;
  const stock = snap.stock;

  // 检验登记人 = 在职仓管（后端用户数据）
  const inspectors = snap.users
    .filter((user) => user.role === "warehouse" && user.active)
    .map((user) => user.name);

  const [bomCode, setBomCode] = useState(initialBomCode);
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(todayIso);
  const [inspector, setInspector] = useState("");
  const [remark, setRemark] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 用户列表异步到达前 inspector 可能为空，落在首个可用登记人
  const effectiveInspector = inspectors.includes(inspector)
    ? inspector
    : (inspectors[0] ?? "");

  const selectedBom = boms.find((bom) => bom.code === bomCode);
  const currentStock = stock[bomCode] || 0;
  const previewQty = Number(qty) || 0;

  const reset = () => {
    setBomCode("");
    setQty("");
    setDate(todayIso());
    setInspector("");
    setRemark("");
    setErrors({});
  };

  const submit = () => {
    if (createInbound.isPending) return;
    const nextErrors: Record<string, string> = {};
    if (!date) nextErrors.date = "请选择入库日期";
    if (!bomCode) nextErrors.bomCode = "请选择成品";
    if (!qty || Number(qty) <= 0) nextErrors.qty = "请填写入库数量";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')
          ?.focus(),
      );
    if (Object.keys(nextErrors).length > 0) return;
    createInbound.mutate(
      { bomCode, qty: Number(qty), date, inspector: effectiveInspector, remark },
      {
        onError: (error) => toast(error.message, true),
        onSuccess: (row) => {
          toast(`入库单 ${row.no} 已登记`);
          onClose();
          reset();
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="检验成品入库"
      subtitle="登记检验合格并可用的成品"
      width={600}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-btn border border-line-strong bg-white px-4 text-[13px] font-medium text-ink hover:border-primary-border"
          >
            取消
          </button>
          <button
            type="button"
            disabled={createInbound.isPending}
            onClick={submit}
            className="min-h-10 rounded-btn bg-primary px-4 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {createInbound.isPending ? "正在登记…" : "确认入库"}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <SearchSelect
            label="成品"
            required
            error={errors.bomCode}
            value={bomCode}
            onChange={setBomCode}
            options={boms.map((bom) => ({
              value: bom.code,
              label: `${bom.code} · ${bom.spec}`,
            }))}
          />
        </div>
        <TextField
          label="入库数量（件）"
          required
          inputMode="numeric"
          placeholder="如 1600"
          error={errors.qty}
          value={qty}
          onChange={(event) => setQty(event.target.value.replace(/\D/g, ""))}
        />
        <DateField
          label="入库日期"
          error={errors.date}
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <SelectField
          label="检验登记人"
          value={effectiveInspector}
          onChange={(event) => setInspector(event.target.value)}
        >
          {inspectors.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </SelectField>
        <TextArea
          label="备注"
          placeholder="选填"
          value={remark}
          onChange={(event) => setRemark(event.target.value)}
        />
        {selectedBom && (
          <div className="rounded-[12px] border border-line bg-[#fcfcfd] px-3.5 py-3 text-[12.5px] sm:col-span-2">
            <div className="font-semibold text-ink">
              {selectedBom.code}
            </div>
            <div className="mt-1 text-muted">{selectedBom.spec}</div>
            <div className="tnum mt-1.5 font-medium text-primary-strong">
              当前库存 {num(currentStock)} 件 · 入库后{" "}
              {num(currentStock + previewQty)} 件
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function VoucherModal({
  row,
  snap,
  onClose,
}: {
  row: InboundRow | null;
  snap: Snapshot;
  onClose: () => void;
}) {
  if (!row) return null;
  const bom = bomByCode(snap, row.bomCode);
  return (
    <Modal
      open={!!row}
      onClose={onClose}
      label="入库凭证"
      title={row.no}
      subtitle={row.bomCode}
      width={480}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="min-h-10 rounded-btn bg-primary px-4 text-[13px] font-medium text-white hover:bg-primary-hover"
        >
          关闭
        </button>
      }
    >
      <div className="flex flex-col gap-2 text-[13px]">
        <p className="rounded-[10px] bg-primary-soft/70 px-3 py-2 text-[12.5px] text-primary-strong">
          {bom?.spec}
        </p>
        {[
          ["入库数量", `${num(row.qty)} 件`],
          ["入库日期", row.date],
          ["登记时间", row.time],
          ["检验登记人", row.inspector],
          ["备注", row.remark || "—"],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-4 border-b border-line/70 pb-1.5"
          >
            <span className="text-muted">{label}</span>
            <span className="tnum font-medium text-ink">{value}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function InboundPage() {
  const { can } = useApp();
  const { data, isLoading } = useWbSnapshot();
  const snap = data ?? EMPTY_SNAPSHOT;
  const [searchParams, setSearchParams] = useSearchParams();
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("全部品类");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [newOpen, setNewOpen] = useState(false);
  const [voucher, setVoucher] = useState<InboundRow | null>(null);

  const rows = snap.inboundLedger;
  const boms = snap.boms;
  const bomCategory = new Map(boms.map((bom) => [bom.code, bom.name]));
  const categories = [...new Set(boms.map((bom) => bom.name))];

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((row) => {
      if (category !== "全部品类" && bomCategory.get(row.bomCode) !== category)
        return false;
      return (
        !kw ||
        `${row.no} ${row.bomCode} ${row.inspector}`
          .toLowerCase()
          .includes(kw)
      );
    });
  }, [rows, keyword, category, bomCategory]);

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) =>
        a.date === b.date
          ? b.no.localeCompare(a.no)
          : b.date.localeCompare(a.date),
      ),
    [filtered],
  );
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
  const canRegister = can("inbound:register");

  useEffect(() => {
    if (searchParams.get("new") === "inbound") {
      setNewOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        title="成品入库"
        description="登记已确认可用的成品。"
        actions={
          canRegister ? (
            <Button icon="inbound" onClick={() => setNewOpen(true)}>
              检验入库
            </Button>
          ) : undefined
        }
      />

      <section className="overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
        <div className="list-toolbar flex flex-wrap items-center gap-2.5 border-b border-line bg-gradient-to-b from-white to-[#fcfcfd] px-5 py-4">
          <label className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 sm:max-w-[300px]">
            <Icon name="search" size={15} className="text-subtle" />
            <input
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                setPage(1);
              }}
              placeholder="搜索单号、BOM 编码或登记人"
              className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-subtle"
            />
          </label>
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setPage(1);
            }}
            aria-label="按品类筛选"
            className="h-10 rounded-[10px] border border-line-strong bg-white px-3 text-[13px] text-ink"
          >
            <option>全部品类</option>
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>

          <ToolbarMore>
            <Button
              variant="secondary"
              icon="refresh"
              data-low-priority="true"
              onClick={() => {
                setKeyword("");
                setCategory("全部品类");
                setPage(1);
              }}
            >
              重置
            </Button>
            <Button
              variant="secondary"
              icon="download"
              data-low-priority="true"
              onClick={() =>
                downloadCsv(
                  "成品入库",
                  [
                    "入库单号",
                    "BOM 编码",
                    "入库数量",
                    "入库日期",
                    "检验登记人",
                  ],
                  pageRows.map((row) => [
                    row.no,
                    row.bomCode,
                    String(row.qty),
                    row.date,
                    row.inspector,
                  ]),
                )
              }
            >
              导出
            </Button>
          </ToolbarMore>
        </div>

        <div className="mobile-records">
          <ListState loading={isLoading} empty={!pageRows.length}>
            {pageRows.map((row) => (
              <RecordCard
                key={row.no}
                title={row.bomCode}
                subtitle={`${row.date} · ${row.no}`}
                badge={
                  <strong className="text-success">+{num(row.qty)} 件</strong>
                }
                actions={
                  <Button variant="secondary" onClick={() => setVoucher(row)}>
                    查看凭证
                  </Button>
                }
              >
                <p>{bomByCode(snap, row.bomCode)?.spec}</p>
                <p className="mt-2 text-[13px] text-muted">
                  登记人 {row.inspector}
                </p>
              </RecordCard>
            ))}
          </ListState>
        </div>
        <div className="hidden overflow-x-auto lg:block">
          {isLoading ? (
            <div className="py-16 text-center text-[13px] text-subtle">
              加载中…
            </div>
          ) : (
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr className="bg-[#f8fafc] text-left text-[12px] text-muted">
                  <th className="px-5 py-2.5 font-semibold">入库单号</th>
                  <th className="px-3 py-2.5 font-semibold">BOM 编码</th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    入库数量
                  </th>
                  <th className="px-3 py-2.5 font-semibold">入库日期</th>
                  <th className="px-3 py-2.5 font-semibold">检验登记人</th>
                  <th className="px-5 py-2.5 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-5 py-14 text-center text-[13px] text-subtle"
                    >
                      没有找到匹配的入库记录
                    </td>
                  </tr>
                )}
                {pageRows.map((row) => (
                  <tr
                    key={row.no}
                    className="border-t border-line/70 transition hover:bg-row-hover"
                  >
                    <td className="px-5 py-3 tnum text-[13px] font-semibold text-[#475467]">
                      {row.no}
                    </td>
                    <td className="px-3 py-3 tnum text-[12.5px] font-medium text-primary-strong">
                      {row.bomCode}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <QtyCell value={row.qty} unit="件" />
                    </td>
                    <td className="px-3 py-3 tnum text-[13px] text-td">
                      {row.date}
                    </td>
                    <td className="px-3 py-3 text-[13px] text-td">
                      {row.inspector}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setVoucher(row)}
                        className="text-[13px] font-medium text-primary-strong underline-offset-2 hover:underline"
                      >
                        查看凭证
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t border-line">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={filtered.length}
            unit="条入库记录"
            onPageChange={setPage}
          />
        </div>
      </section>

      {canRegister && (
        <InboundModal open={newOpen} onClose={() => setNewOpen(false)} />
      )}
      <VoucherModal row={voucher} snap={snap} onClose={() => setVoucher(null)} />
    </div>
  );
}
