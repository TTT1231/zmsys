import { ToolbarMore } from "../../components/ui/ToolbarMore";
import { ListState, RecordCard } from "../../components/ui/MobileList";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "../../lib/icons";
import { downloadCsv, num } from "../../lib/format";
import { useApp } from "../../context/AppContext";
import { PageHeading } from "../../components/ui/PageHeading";
import { Button, TableLink } from "../../components/ui/Badge";
import { Pagination } from "../../components/ui/Pagination";
import { Modal } from "../../components/ui/Modal";
import { SelectField, TextField } from "../../components/ui/Field";
import { useCreateBom, useWbSnapshot } from "../../data/queries";
import { useToast } from "../../components/ui/Toast";
import {
  BOM_CATEGORIES,
  categoryOf,
  initialValuesOf,
  nextBomCode,
} from "../../data/categories";
import type { Bom } from "../../data/types";

/* BOM 规格行：品类 + 型号 + 各品类规格键值对 */
function specLines(bom: Bom) {
  return [
    ["品类", bom.name],
    ["型号", bom.modelCode],
    ...Object.entries(bom.specs).map(
      ([key, value]) => [key, value || "—"] as [string, string],
    ),
  ];
}

export function BomDetailModal({
  bom,
  onClose,
}: {
  bom: Bom | null;
  onClose: () => void;
}) {
  if (!bom) return null;
  return (
    <Modal
      open={!!bom}
      onClose={onClose}
      label="BOM 详情"
      title={bom.code}
      subtitle={`${bom.name} · ${bom.modelCode}`}
      width={560}
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
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {specLines(bom).map(([label, value]) => (
            <div
              key={label}
              className="rounded-[10px] border border-line px-3 py-2"
            >
              <div className="text-[11px] text-muted">{label}</div>
              <div className="truncate text-[13px] font-medium text-ink">
                {value}
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-[10px] bg-primary-soft/70 px-3 py-2 text-[12.5px] text-primary-strong">
          {bom.spec}
        </div>
      </div>
    </Modal>
  );
}

function NewBomModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data } = useWbSnapshot();
  const createBom = useCreateBom();
  const toast = useToast();
  const [name, setName] = useState("");
  const [modelCode, setModelCode] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const boms = data?.boms ?? [];
  const category = categoryOf(name);

  const nextCode = useMemo(
    () => (category ? nextBomCode(name, boms.map((bom) => bom.code)) : "—"),
    [category, name, boms],
  );

  const pickCategory = (next: string) => {
    setName(next);
    setModelCode("");
    setValues(next ? initialValuesOf(categoryOf(next)!) : {});
    setErrors({});
  };

  const setValue = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const submit = () => {
    const nextErrors: Record<string, string> = {};
    if (!category) nextErrors.name = "请选择产品品类";
    if (!modelCode.trim()) nextErrors.modelCode = "请填写型号";
    category?.fields
      .filter((field) => field.required)
      .forEach((field) => {
        if (!values[field.key]?.trim())
          nextErrors[field.key] = `请填写${field.label}`;
      });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')
          ?.focus(),
      );
    if (Object.keys(nextErrors).length > 0) return;
    createBom.mutate(
      { name, modelCode: modelCode.trim(), specs: values },
      {
        onSuccess: (bom) => {
          toast(`BOM ${bom.code} 已创建`);
          onClose();
          pickCategory("");
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建 BOM"
      subtitle="枚举规格点选，型号与自由规格手动输入"
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
            disabled={createBom.isPending}
            onClick={submit}
            className="min-h-10 rounded-btn bg-primary px-4 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-60"
          >
            保存 BOM
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label="① 产品品类"
          required
          error={errors.name}
          value={name}
          onChange={(event) => pickCategory(event.target.value)}
        >
          <option value="">请选择</option>
          {BOM_CATEGORIES.map((item) => (
            <option key={item.name}>{item.name}</option>
          ))}
        </SelectField>
        <TextField
          label={
            category?.name === "旋转开关" ? "② 型号 · 触点面" : "② 型号"
          }
          required
          placeholder={
            category?.name === "旋转开关"
              ? "如 2-1"
              : category?.name === "微动开关"
                ? "如 KW-4"
                : category?.name === "跌倒开关"
                  ? "如 DD-3"
                  : "请先选择品类"
          }
          error={errors.modelCode}
          value={modelCode}
          onChange={(event) => setModelCode(event.target.value)}
        />
        {category?.fields.map((field) =>
            field.type === "select" ? (
              <SelectField
                key={field.key}
                label={field.label}
                required={field.required}
                error={errors[field.key]}
                value={values[field.key] ?? ""}
                onChange={(event) => setValue(field.key, event.target.value)}
              >
                <option value="">请选择</option>
                {field.options?.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </SelectField>
            ) : (
              <TextField
                key={field.key}
                label={field.label}
                required={field.required}
                placeholder={field.placeholder}
                error={errors[field.key]}
                value={values[field.key] ?? ""}
                onChange={(event) => setValue(field.key, event.target.value)}
              />
            ),
          )}
        <div className="rounded-[12px] border border-line bg-[#fcfcfd] px-3.5 py-3 text-[12.5px] sm:col-span-3">
          <div className="mb-1 font-semibold text-ink">预览</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted sm:grid-cols-3">
            <span>品类：{name || "—"}</span>
            <span className="tnum">BOM 编码：{nextCode}</span>
            <span>型号：{modelCode.trim() || "—"}</span>
            {Object.entries(values)
              .filter(([, value]) => value && value.trim())
              .map(([key, value]) => (
                <span key={key}>
                  {key}：{value}
                </span>
              ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function QuickFindModal({
  open,
  onClose,
  onDetail,
}: {
  open: boolean;
  onClose: () => void;
  onDetail: (bom: Bom) => void;
}) {
  const { data } = useWbSnapshot();
  const [name, setName] = useState("");
  const [keyword, setKeyword] = useState("");
  const boms = data?.boms ?? [];
  const results = boms
    .filter((bom) => !name || bom.name === name)
    .filter(
      (bom) =>
        !keyword.trim() ||
        `${bom.code} ${bom.name} ${bom.spec}`
          .toLowerCase()
          .includes(keyword.trim().toLowerCase()),
    )
    .slice(0, 6);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="快速查找 BOM"
      subtitle="按品类筛选或关键词搜索"
      width={560}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="min-h-10 rounded-btn border border-line-strong bg-white px-4 text-[13px] font-medium text-ink hover:border-primary-border"
        >
          关闭
        </button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label="品类"
          value={name}
          onChange={(event) => setName(event.target.value)}
        >
          <option value="">全部</option>
          {BOM_CATEGORIES.map((item) => (
            <option key={item.name}>{item.name}</option>
          ))}
        </SelectField>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[12.5px] font-medium text-[#344054]">
            关键词
          </span>
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="编码 / 型号 / 规格"
            className="w-full rounded-[9px] border border-line-strong px-3 py-2 text-[13px] outline-none focus:border-primary"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        {results.length === 0 && (
          <p className="py-3 text-center text-[12.5px] text-subtle">
            没有匹配的 BOM
          </p>
        )}
        {results.map((bom) => (
          <button
            key={bom.code}
            type="button"
            onClick={() => onDetail(bom)}
            className="rounded-[10px] border border-line px-3 py-2 text-left transition hover:border-primary-border hover:bg-primary-soft/40"
          >
            <span className="text-[11.5px] font-medium text-muted">
              {bom.name}
            </span>
            <span className="tnum ml-2 text-[12.5px] font-semibold text-primary-strong">
              {bom.code}
            </span>
            <span className="mt-0.5 block truncate text-[11.5px] text-muted">
              {bom.spec}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function BomPage() {
  const { can } = useApp();
  const { data, isLoading } = useWbSnapshot();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("全部品类");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [newOpen, setNewOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [detail, setDetail] = useState<Bom | null>(null);

  const boms = data?.boms ?? [];
  const categories = useMemo(
    () => [...new Set(boms.map((bom) => bom.name))],
    [boms],
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return boms
      .filter(
        (bom) => category === "全部品类" || bom.name === category,
      )
      .filter(
        (bom) =>
          !kw ||
          `${bom.code} ${bom.name} ${bom.modelCode} ${bom.spec}`
            .toLowerCase()
            .includes(kw),
      );
  }, [boms, keyword, category]);

  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const canCreate = can("bom:create");

  useEffect(() => {
    if (searchParams.get("new") === "bom") {
      setNewOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        title="物料与 BOM"
        actions={
          canCreate ? (
            <>
              <Button
                variant="secondary"
                icon="search"
                onClick={() => setQuickOpen(true)}
              >
                快速查找 BOM
              </Button>
              <Button icon="plus" onClick={() => setNewOpen(true)}>
                新建 BOM
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              icon="search"
              onClick={() => setQuickOpen(true)}
            >
              快速查找 BOM
            </Button>
          )
        }
      />

      <section className="overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
        <div className="list-toolbar flex flex-wrap items-center justify-between gap-2.5 border-b border-line bg-gradient-to-b from-white to-[#fcfcfd] px-5 py-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex h-10 min-w-[220px] items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 sm:w-[300px]">
              <Icon name="search" size={15} className="text-subtle" />
              <input
                value={keyword}
                onChange={(event) => {
                  setKeyword(event.target.value);
                  setPage(1);
                }}
                placeholder="搜索编码 / 品类 / 型号 / 规格"
                className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-subtle"
              />
            </label>
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}
              className="h-10 rounded-[10px] border border-line-strong bg-white px-3 text-[13px] text-ink"
              aria-label="按品类筛选"
            >
              <option>全部品类</option>
              {categories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
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
                  "BOM",
                  ["序号", "BOM编码", "品类", "型号", "单位", "规格"],
                  pageRows.map((bom, index) => [
                    String((page - 1) * pageSize + index + 1),
                    bom.code,
                    bom.name,
                    bom.modelCode,
                    bom.unit,
                    bom.spec,
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
            {pageRows.map((bom) => (
              <RecordCard
                key={bom.code}
                title={`${bom.name} · ${bom.modelCode}`}
                subtitle={bom.code}
                actions={
                  <Button onClick={() => setDetail(bom)}>查看规格</Button>
                }
              >
                <p>{bom.spec}</p>
                <p className="mt-2 text-[13px] text-muted">
                  库存 {num(data?.stock[bom.code] ?? 0)} 件
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
            <table className="w-full min-w-[920px] border-collapse">
              <thead>
                <tr className="bg-[#f8fafc] text-left text-[12px] text-muted">
                  <th
                    className="px-5 py-2.5 font-semibold"
                    style={{ width: "6%" }}
                  >
                    序号
                  </th>
                  <th
                    className="px-3 py-2.5 font-semibold"
                    style={{ width: "16%" }}
                  >
                    BOM 编码
                  </th>
                  <th
                    className="px-3 py-2.5 font-semibold"
                    style={{ width: "10%" }}
                  >
                    品类
                  </th>
                  <th
                    className="px-3 py-2.5 font-semibold"
                    style={{ width: "8%" }}
                  >
                    型号
                  </th>
                  <th
                    className="px-3 py-2.5 font-semibold"
                    style={{ width: "9%" }}
                  >
                    单位（个）
                  </th>
                  <th className="px-3 py-2.5 font-semibold">规格</th>
                  <th
                    className="px-5 py-2.5 text-right font-semibold"
                    style={{ width: "10%" }}
                  >
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-5 py-14 text-center text-[13px] text-subtle"
                    >
                      暂无 BOM
                    </td>
                  </tr>
                )}
                {pageRows.map((bom, index) => (
                  <tr
                    key={bom.code}
                    className="border-t border-line/70 transition hover:bg-row-hover"
                  >
                    <td className="px-5 py-3 tnum text-[13px] text-muted">
                      {(page - 1) * pageSize + index + 1}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => setDetail(bom)}
                        className="tnum text-[13px] font-semibold text-primary-strong underline-offset-2 hover:underline"
                      >
                        {bom.code}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-td">
                      {bom.name}
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-block rounded-[6px] border border-[#e0e7ff] bg-primary-soft px-1.5 py-0.5 text-[11.5px] font-medium text-primary-strong">
                        {bom.modelCode}
                      </span>
                    </td>
                    <td className="px-3 py-3 tnum text-[13px] text-td">1</td>
                    <td className="px-3 py-3">
                      <span
                        className="block max-w-[360px] truncate text-[12.5px] text-td"
                        title={bom.spec}
                      >
                        {bom.spec}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <TableLink onClick={() => setDetail(bom)}>
                        查看详情
                      </TableLink>
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
            unit="条 BOM"
            onPageChange={setPage}
          />
        </div>
      </section>

      {canCreate && (
        <NewBomModal open={newOpen} onClose={() => setNewOpen(false)} />
      )}
      <QuickFindModal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        onDetail={(bom) => {
          setQuickOpen(false);
          setDetail(bom);
          toast(`已定位到 ${bom.code}`);
        }}
      />
      <BomDetailModal bom={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
