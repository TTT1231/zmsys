import type { ReactNode } from "react";
import type { Bom, BomCategory } from "@/api";
import { BomSpecs } from "@/components/bom/BomSpecs";
import { BomRemarkNote } from "@/components/bom/BomRemarkNote";
import { num } from "@/lib/format";

/** 业务凭证共用的数量概览、成品详情与登记信息，保持一致的阅读顺序。 */
export function RecordSummary({
    metrics,
    status,
    note,
}: {
    metrics: { label: string; value: number }[];
    status: ReactNode;
    note?: string;
}) {
    const single = metrics.length === 1;
    return (
        <section aria-label="数量与状态" className="rounded-card bg-soft p-3.5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-12 text-muted">{single ? metrics[0].label : "数量（个）"}</span>
                {status}
            </div>
            <dl className="grid gap-3" style={{ gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))` }}>
                {metrics.map(metric => (
                    <div key={metric.label} className="min-w-0 border-l border-line pl-3 first:border-0 first:pl-0">
                        <dt className={single ? "sr-only" : "text-12 text-muted"}>{metric.label}</dt>
                        <dd className="tnum mt-1 text-22 font-semibold leading-tight text-ink wrap-anywhere">
                            {num(metric.value)}
                            {single && <span className="ml-1.5 text-13 font-normal text-muted">个</span>}
                        </dd>
                    </div>
                ))}
            </dl>
            {note && <p className="mt-3 text-12 leading-5 text-muted">{note}</p>}
        </section>
    );
}

export function RecordProduct({
    bom,
    bomCode,
    categories,
}: {
    bom?: Bom;
    bomCode: string;
    categories?: BomCategory[];
}) {
    return (
        <section aria-label="详情" className="min-w-0">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="text-14 font-medium text-ink">详情</h3>
                <p className="tnum text-12 text-muted wrap-anywhere">{bomCode}</p>
            </div>
            {bom ? (
                <>
                    <BomSpecs bom={bom} categories={categories} layout="record" />
                    <BomRemarkNote remark={bom.remark} className="mt-3" />
                </>
            ) : (
                <p className="text-14 text-muted">未找到该成品的物料信息</p>
            )}
        </section>
    );
}

export function RecordFields({
    title,
    items,
}: {
    title: string;
    items: { label: string; value: ReactNode; fullWidth?: boolean }[];
}) {
    return (
        <section aria-label={title} className="border-t border-line pt-4">
            <h3 className="mb-3 text-14 font-medium text-ink">{title}</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                {items.map(item => (
                    <div key={item.label} className={item.fullWidth ? "col-span-full min-w-0" : "min-w-0"}>
                        <dt className="text-12 leading-5 text-muted">{item.label}</dt>
                        <dd className="tnum mt-1 whitespace-pre-wrap text-14 leading-6 text-td wrap-anywhere">
                            {item.value}
                        </dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}
