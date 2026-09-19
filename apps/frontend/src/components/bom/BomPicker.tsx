/* 共享 BOM 选择器（入库建档用）：品类内按编码/物料关键字搜索 + 列表点选。
 * 预生成组合废除后 BOM 总量小，搜索定位取代旧的逐级规格收敛引擎。 */
import { useMemo, useState } from "react";
import type { Bom } from "@/api";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

interface BomPickerProps {
    boms: Bom[];
    selected?: Bom;
    onSelect: (bom: Bom) => void;
    error?: string;
    /** 行尾补充信息（如入库选择器展示当前库存） */
    rowExtra?: (bom: Bom) => string | undefined;
}

const searchTextOf = (bom: Bom): string =>
    `${bom.code} ${bom.name} ${bom.spec} ${bom.items.map(item => `${item.groupName} ${item.name}`).join(" ")}`;

export function BomPicker({ boms, selected, onSelect, error, rowExtra }: BomPickerProps) {
    const [keyword, setKeyword] = useState("");
    const kw = keyword.trim().toLowerCase();
    const filtered = useMemo(
        () => (kw ? boms.filter(bom => searchTextOf(bom).toLowerCase().includes(kw)) : boms),
        [boms, kw],
    );

    return (
        <div className="flex flex-col gap-2">
            <label className="flex h-10 items-center gap-2 rounded-btn border border-line-strong bg-surface px-3">
                <input
                    value={keyword}
                    onChange={event => setKeyword(event.target.value)}
                    placeholder="BOM / 物料"
                    aria-label="搜索 BOM"
                    className="w-full bg-transparent text-13 text-ink outline-none placeholder:text-subtle"
                />
            </label>
            <p className="text-12 text-muted" aria-live="polite">
                共 {num(filtered.length)} 条 BOM 可选
            </p>
            <div className="flex max-h-60 flex-col gap-1.5 overflow-y-auto">
                {filtered.length === 0 && (
                    <p className="py-3 text-center text-12.5 text-subtle">没有匹配的 BOM，请调整关键字</p>
                )}
                {filtered.map(bom => {
                    const active = selected?.code === bom.code;
                    const extra = rowExtra?.(bom);
                    return (
                        <button
                            key={bom.code}
                            type="button"
                            onClick={() => onSelect(bom)}
                            className={cn(
                                "cursor-pointer rounded-btn border px-3 py-2 text-left transition hover:border-primary-border hover:bg-primary-soft/40",
                                active ? "border-primary-border bg-primary-soft/50" : "border-line",
                            )}
                        >
                            <span className="text-11.5 font-medium text-muted">{bom.name}</span>
                            <span className="tnum ml-2 text-12.5 font-semibold text-primary-strong">{bom.code}</span>
                            {active && (
                                <span className="ml-2 rounded-full bg-surface px-1.5 py-0.5 text-10.5 font-medium text-success">
                                    已选
                                </span>
                            )}
                            <span className="mt-0.5 block truncate text-11.5 text-muted" title={bom.spec}>
                                {bom.spec}
                            </span>
                            {extra && <span className="mt-0.5 block text-11 text-subtle">{extra}</span>}
                        </button>
                    );
                })}
            </div>
            {error && (
                <p role="alert" className="text-12 text-danger">
                    {error}
                </p>
            )}
        </div>
    );
}
