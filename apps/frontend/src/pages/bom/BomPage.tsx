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
import { SelectField, TextArea, TextField } from "../../components/ui/Field";
import { useCreateCustomBom, useWbSnapshot } from "../../data/queries";
import { useToast } from "../../components/ui/Toast";
import type { Bom } from "../../data/types";

/* BOM 规格行 */
function specLines(bom: Bom) {
  return [
    ["品名", bom.name],
    ["脚位", bom.seriesLabel],
    ["档位", bom.gear || "—"],
    ["型号", bom.modelCode],
    ["规格", bom.gearSpec || "—"],
    ["方向", bom.gearDir || "—"],
    ["A面触点", "A面银点"],
    ["B面触点", "B面塑料盖板"],
    ["弹簧", bom.spring],
    ["银点厚度", bom.thickness],
    ["杆子高度", "4.8"],
  ] as Array<[string, string]>;
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
      subtitle={`${bom.name} · ${bom.model}`}
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
        <div className="rounded-[10px] border border-line px-3 py-2 text-[12.5px] text-td">
          <span className="text-muted">备注：</span>
          {bom.remark || "—"}
        </div>
      </div>
    </Modal>
  );
}

const FOOT_OPTIONS = ["二脚", "三脚", "四脚", "五脚", "六脚"];
const GEAR_OPTIONS = ["一档", "两档", "三档", "四档", "五档", "六档", "八档"];

function NewBomModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const createBom = useCreateCustomBom();
  const toast = useToast();
  const [foot, setFoot] = useState("");
  const [gear, setGear] = useState("");
  const [modelFace, setModelFace] = useState("");
  const [thickness, setThickness] = useState("0.2");
  const [spring, setSpring] = useState("0.5");
  const [remark, setRemark] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const hash = Math.abs(
    [...`${foot}${gear}${modelFace}`].reduce(
      (acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0,
      7,
    ),
  )
    .toString(36)
    .toUpperCase()
    .padEnd(6, "0")
    .slice(0, 6);

  const reset = () => {
    setFoot("");
    setGear("");
    setModelFace("");
    setThickness("0.2");
    setSpring("0.5");
    setRemark("");
    setErrors({});
  };

  const submit = () => {
    const nextErrors: Record<string, string> = {};
    if (!foot) nextErrors.foot = "请选择脚位";
    if (!gear) nextErrors.gear = "请选择档位";
    if (!modelFace) nextErrors.modelFace = "请填写型号 · 触点面";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')
          ?.focus(),
      );
    if (Object.keys(nextErrors).length > 0) return;
    createBom.mutate(
      {
        foot,
        model: "XK2",
        contactFace: modelFace,
        gearSpec: gear,
        thickness,
        spring,
        stemHeight: "4.8",
        remark,
      },
      {
        onSuccess: (bom) => {
          toast(`BOM ${bom.code} 已创建，已归入定制 BOM`);
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
      title="新建 BOM · 旋转开关 XK2"
      subtitle="按脚位 → 型号与触点面 → 档位逐步建档"
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
          label="① 脚位"
          required
          error={errors.foot}
          value={foot}
          onChange={(event) => setFoot(event.target.value)}
        >
          <option value="">请选择</option>
          {FOOT_OPTIONS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </SelectField>
        <TextField
          label="② 型号 · 触点面"
          required
          placeholder="如 2-1"
          error={errors.modelFace}
          value={modelFace}
          onChange={(event) => setModelFace(event.target.value)}
        />
        <SelectField
          label="③ 档位"
          required
          error={errors.gear}
          value={gear}
          onChange={(event) => setGear(event.target.value)}
        >
          <option value="">请选择</option>
          {GEAR_OPTIONS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </SelectField>
        <SelectField
          label="银点厚度"
          value={thickness}
          onChange={(event) => setThickness(event.target.value)}
        >
          {["0.2", "0.3"].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </SelectField>
        <SelectField
          label="弹簧"
          value={spring}
          onChange={(event) => setSpring(event.target.value)}
        >
          {["0.5", "0.55", "0.6"].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </SelectField>
        <div className="sm:col-span-3">
          <TextArea
            label="备注"
            placeholder="非空备注会自动归入「定制 BOM」"
            value={remark}
            onChange={(event) => setRemark(event.target.value)}
          />
        </div>
        <div className="rounded-[12px] border border-line bg-[#fcfcfd] px-3.5 py-3 text-[12.5px] sm:col-span-3">
          <div className="mb-1 font-semibold text-ink">预览</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted sm:grid-cols-3">
            <span>
              规格：{[foot, modelFace].filter(Boolean).join(" ") || "—"}
            </span>
            <span className="tnum">BOM 编码：BOM-XK2-{hash || "??????"}</span>
            <span>类型：{remark.trim() ? "定制 BOM" : "通用 BOM"}</span>
            <span>弹簧规格：{spring}</span>
            <span>银点厚度：{thickness}</span>
            <span>杆子高度：4.8</span>
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
  const [foot, setFoot] = useState("");
  const [gear, setGear] = useState("");
  const [keyword, setKeyword] = useState("");
  const boms = data?.boms ?? [];
  const results = boms
    .filter((bom) => !bom.custom)
    .filter(
      (bom) =>
        (!foot || bom.seriesLabel === foot) && (!gear || bom.gear === gear),
    )
    .filter(
      (bom) =>
        !keyword.trim() ||
        `${bom.code} ${bom.spec}`
          .toLowerCase()
          .includes(keyword.trim().toLowerCase()),
    )
    .slice(0, 6);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="快速查找 BOM"
      subtitle="按特征筛选或关键词搜索"
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
          label="脚位"
          value={foot}
          onChange={(event) => setFoot(event.target.value)}
        >
          <option value="">全部</option>
          {FOOT_OPTIONS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </SelectField>
        <SelectField
          label="档位"
          value={gear}
          onChange={(event) => setGear(event.target.value)}
        >
          <option value="">全部</option>
          {GEAR_OPTIONS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </SelectField>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-[#344054]">
            关键词
          </span>
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="编码 / 规格"
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
            <span className="tnum text-[12.5px] font-semibold text-primary-strong">
              {bom.productCode}
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
  const { role } = useApp();
  const { data, isLoading } = useWbSnapshot();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const [tab, setTab] = useState<"generic" | "custom">("generic");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [newOpen, setNewOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [detail, setDetail] = useState<Bom | null>(null);

  const boms = data?.boms ?? [];
  const genericCount = boms.filter((bom) => !bom.custom).length;
  const customCount = boms.filter((bom) => bom.custom).length;

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return boms.filter((bom) => {
      if (tab === "generic" && bom.custom) return false;
      if (tab === "custom" && !bom.custom) return false;
      if (
        kw &&
        !`${bom.code} ${bom.modelCode} ${bom.spec} ${bom.remark}`
          .toLowerCase()
          .includes(kw)
      )
        return false;
      return true;
    });
  }, [boms, tab, keyword]);

  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const canCreate = role === "admin";

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
          <div className="flex items-center gap-1 rounded-full border border-line bg-white p-1">
            {(
              [
                { key: "generic", label: "通用 BOM", count: genericCount },
                { key: "custom", label: "定制 BOM", count: customCount },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setTab(item.key);
                  setPage(1);
                }}
                className={`h-[30px] rounded-full px-3.5 text-[12.5px] font-medium transition ${
                  tab === item.key
                    ? "bg-primary text-white"
                    : "text-muted hover:text-primary"
                }`}
              >
                {item.label}
                <span
                  className={`tnum ml-1 text-[11px] ${tab === item.key ? "text-[#c7d2fe]" : "text-subtle"}`}
                >
                  {item.count}
                </span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex h-10 min-w-[220px] items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 sm:w-[300px]">
              <Icon name="search" size={15} className="text-subtle" />
              <input
                value={keyword}
                onChange={(event) => {
                  setKeyword(event.target.value);
                  setPage(1);
                }}
                placeholder="搜索编码 / 型号 / 规格 / 备注"
                className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-subtle"
              />
            </label>
          </div>
          <ToolbarMore>
            <Button
              variant="secondary"
              icon="refresh"
              data-low-priority="true"
              onClick={() => {
                setKeyword("");
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
                  `${tab === "generic" ? "通用" : "定制"}BOM`,
                  ["序号", "BOM编码", "品名", "型号", "单位", "规格", "备注"],
                  pageRows.map((bom, index) => [
                    String((page - 1) * pageSize + index + 1),
                    bom.code,
                    bom.name,
                    bom.model,
                    bom.unit,
                    bom.spec,
                    bom.remark,
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
                title={`${bom.name} · ${bom.seriesLabel} · ${bom.gear || bom.modelCode}`}
                subtitle={bom.productCode}
                actions={
                  <Button onClick={() => setDetail(bom)}>查看规格</Button>
                }
              >
                <p>{bom.spec}</p>
                <p className="mt-2 text-[13px] text-muted">
                  {bom.custom ? "客户定制" : "通用产品"} · 库存{" "}
                  {num(data?.stock[bom.code] ?? 0)} 件
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
                    品名
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
                    className="px-3 py-2.5 font-semibold"
                    style={{ width: "12%" }}
                  >
                    备注
                  </th>
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
                      colSpan={8}
                      className="px-5 py-14 text-center text-[13px] text-subtle"
                    >
                      暂无{tab === "generic" ? "通用" : "定制"} BOM
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
                        {bom.model}
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
                    <td className="px-3 py-3 text-[12.5px] text-muted">
                      {bom.remark || "—"}
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
            unit={`条${tab === "generic" ? "通用" : "定制"} BOM`}
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
          toast(`已定位到 ${bom.productCode}`);
        }}
      />
      <BomDetailModal bom={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
