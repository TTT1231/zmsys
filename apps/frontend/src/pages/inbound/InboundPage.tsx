import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "../../lib/icons";
import { downloadCsv, num } from "../../lib/format";
import { useApp } from "../../context/AppContext";
import { PageHeading } from "../../components/ui/PageHeading";
import { Button } from "../../components/ui/Badge";
import { Pagination } from "../../components/ui/Pagination";
import { Modal } from "../../components/ui/Modal";
import { QtyCell } from "../../components/ui/cells";
import { DateField, SelectField, TextArea, TextField } from "../../components/ui/Field";
import { useCreateInbound, useWbSnapshot } from "../../data/queries";
import { store } from "../../data/store";
import { useToast } from "../../components/ui/Toast";
import type { InboundRow } from "../../data/types";

const INSPECTORS = ["王师傅", "赵师傅", "周丽"];

function InboundModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useWbSnapshot();
  const createInbound = useCreateInbound();
  const toast = useToast();
  const boms = data?.boms.filter((bom) => !bom.custom) ?? [];
  const stock = data?.stock ?? {};

  const [bomCode, setBomCode] = useState("");
  const [qty, setQty] = useState("");
  const [date, setDate] = useState("2026-09-07");
  const [inspector, setInspector] = useState(INSPECTORS[0]);
  const [remark, setRemark] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const selectedBom = boms.find((bom) => bom.code === bomCode);
  const currentStock = stock[bomCode] || 0;
  const previewQty = Number(qty) || 0;

  const reset = () => {
    setBomCode("");
    setQty("");
    setDate("2026-09-07");
    setInspector(INSPECTORS[0]);
    setRemark("");
    setErrors({});
  };

  const submit = () => {
    const nextErrors: Record<string, string> = {};
    if (!bomCode) nextErrors.bomCode = "请选择成品";
    if (!qty || Number(qty) <= 0) nextErrors.qty = "请填写入库数量";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    createInbound.mutate(
      { bomCode, qty: Number(qty), date, inspector, remark },
      {
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
          <button type="button" onClick={onClose} className="min-h-10 rounded-btn border border-line-strong bg-white px-4 text-[13px] font-medium text-ink hover:border-primary-border">
            取消
          </button>
          <button type="button" disabled={createInbound.isPending} onClick={submit} className="min-h-10 rounded-btn bg-primary px-4 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-60">
            确认入库
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <SelectField label="选择成品" required error={errors.bomCode} value={bomCode} onChange={(event) => setBomCode(event.target.value)}>
            <option value="">请选择成品（编码 / 规格）</option>
            {boms.map((bom) => (
              <option key={bom.code} value={bom.code}>
                {bom.productCode} · {bom.spec}
              </option>
            ))}
          </SelectField>
        </div>
        <TextField label="入库数量（件）" required inputMode="numeric" placeholder="如 1600" error={errors.qty} value={qty} onChange={(event) => setQty(event.target.value.replace(/\D/g, ""))} />
        <DateField label="入库日期" required value={date} onChange={(event) => setDate(event.target.value)} />
        <SelectField label="检验登记人" value={inspector} onChange={(event) => setInspector(event.target.value)}>
          {INSPECTORS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </SelectField>
        <TextArea label="备注" placeholder="选填" value={remark} onChange={(event) => setRemark(event.target.value)} />
        {selectedBom && (
          <div className="rounded-[12px] border border-line bg-[#fcfcfd] px-3.5 py-3 text-[12.5px] sm:col-span-2">
            <div className="font-semibold text-ink">{selectedBom.productCode}</div>
            <div className="mt-1 text-muted">{selectedBom.spec}</div>
            <div className="tnum mt-1.5 font-medium text-primary-strong">
              当前库存 {num(currentStock)} 件 · 入库后 {num(currentStock + previewQty)} 件
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function VoucherModal({ row, onClose }: { row: InboundRow | null; onClose: () => void }) {
  if (!row) return null;
  const bom = store.bomByCode(row.bomCode);
  return (
    <Modal open={!!row} onClose={onClose} label="入库凭证" title={row.no} subtitle={row.productCode} width={480}
      footer={
        <button type="button" onClick={onClose} className="min-h-10 rounded-btn bg-primary px-4 text-[13px] font-medium text-white hover:bg-primary-hover">
          关闭
        </button>
      }
    >
      <div className="flex flex-col gap-2 text-[13px]">
        <p className="rounded-[10px] bg-primary-soft/70 px-3 py-2 text-[12.5px] text-primary-strong">{bom?.spec}</p>
        {[
          ["入库数量", `${num(row.qty)} 件`],
          ["入库日期", row.date],
          ["登记时间", row.time],
          ["检验登记人", row.inspector],
          ["备注", row.remark || "—"],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 border-b border-line/70 pb-1.5">
            <span className="text-muted">{label}</span>
            <span className="tnum font-medium text-ink">{value}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function InboundPage() {
  const { role } = useApp();
  const { data, isLoading } = useWbSnapshot();
  const [searchParams, setSearchParams] = useSearchParams();
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [newOpen, setNewOpen] = useState(false);
  const [voucher, setVoucher] = useState<InboundRow | null>(null);

  const rows = data?.inboundLedger ?? [];

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((row) => `${row.no} ${row.productCode} ${row.inspector}`.toLowerCase().includes(kw));
  }, [rows, keyword]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => (a.date === b.date ? b.no.localeCompare(a.no) : b.date.localeCompare(a.date))),
    [filtered],
  );
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
  const canRegister = role === "admin" || role === "warehouse";

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
        actions={canRegister ? <Button icon="inbound" onClick={() => setNewOpen(true)}>检验入库</Button> : undefined}
      />

      <section className="overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-gradient-to-b from-white to-[#fcfcfd] px-5 py-4">
          <label className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 sm:max-w-[300px]">
            <Icon name="search" size={15} className="text-subtle" />
            <input
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                setPage(1);
              }}
              placeholder="搜索单号、成品编码或登记人"
              className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-subtle"
            />
          </label>
          <Button variant="secondary" icon="refresh" onClick={() => { setKeyword(""); setPage(1); }}>
            重置
          </Button>
          <Button
            variant="secondary"
            icon="download"
            onClick={() =>
              downloadCsv("成品入库", ["入库单号", "成品编码", "入库数量", "入库日期", "检验登记人"], pageRows.map((row) => [row.no, row.productCode, String(row.qty), row.date, row.inspector]))
            }
          >
            导出
          </Button>
        </div>

        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="py-16 text-center text-[13px] text-subtle">加载中…</div>
          ) : (
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr className="bg-[#f8fafc] text-left text-[12px] text-muted">
                  <th className="px-5 py-2.5 font-semibold">入库单号</th>
                  <th className="px-3 py-2.5 font-semibold">成品编码</th>
                  <th className="px-3 py-2.5 text-right font-semibold">入库数量</th>
                  <th className="px-3 py-2.5 font-semibold">入库日期</th>
                  <th className="px-3 py-2.5 font-semibold">检验登记人</th>
                  <th className="px-5 py-2.5 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-14 text-center text-[13px] text-subtle">
                      没有找到匹配的入库记录
                    </td>
                  </tr>
                )}
                {pageRows.map((row) => (
                  <tr key={row.no} className="border-t border-line/70 transition hover:bg-row-hover">
                    <td className="px-5 py-3 tnum text-[13px] font-semibold text-[#475467]">{row.no}</td>
                    <td className="px-3 py-3 tnum text-[12.5px] font-medium text-primary-strong">{row.productCode}</td>
                    <td className="px-3 py-3 text-right">
                      <QtyCell value={row.qty} unit="件" />
                    </td>
                    <td className="px-3 py-3 tnum text-[13px] text-td">{row.date}</td>
                    <td className="px-3 py-3 text-[13px] text-td">{row.inspector}</td>
                    <td className="px-5 py-3 text-right">
                      <button type="button" onClick={() => setVoucher(row)} className="text-[13px] font-medium text-primary-strong underline-offset-2 hover:underline">
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
          <Pagination page={page} pageSize={pageSize} total={filtered.length} unit="条入库记录" onPageChange={setPage} />
        </div>
      </section>

      {canRegister && <InboundModal open={newOpen} onClose={() => setNewOpen(false)} />}
      <VoucherModal row={voucher} onClose={() => setVoucher(null)} />
    </div>
  );
}
