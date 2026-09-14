import type { Bom, BomCategory } from "@/api";

/** 固定宽度的订单规格预览：字段名对齐，长值单行省略，完整核对走订单详情。 */
export function BomCell({ bom, bomCode, category }: { bom?: Bom; bomCode: string; category?: BomCategory }) {
    const fields = category && category.name === bom?.name ? category.fields : [];
    const specs = bom?.specs ?? {};
    const keys = [...new Set([...fields.map(field => field.key), ...Object.keys(specs)])];
    const entries = keys.filter(key => specs[key]?.trim());
    const preview = entries
        .filter(key => fields.find(field => field.key === key)?.defaultValue !== specs[key])
        .slice(0, 3);
    return (
        <div className="w-64 min-w-0 max-w-full">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="tnum text-13 font-medium text-td wrap-anywhere">{bomCode}</span>
                {bom && (
                    <>
                        <span className="max-w-full rounded-md bg-primary-soft px-1.5 py-0.5 tnum text-12 font-medium text-primary-strong wrap-anywhere">
                            {bom.modelCode}
                        </span>
                        <span className="text-12 text-muted">{bom.name}</span>
                    </>
                )}
            </div>
            {preview.length > 0 && (
                <dl className="mt-1.5 grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5">
                    {preview.map(key => (
                        <div key={key} className="contents">
                            <dt className="max-w-24 rounded-sm bg-slate-100 px-1.5 py-0.25 text-12 font-medium leading-5 text-td wrap-anywhere">
                                {fields.find(field => field.key === key)?.label || key}
                            </dt>
                            <dd className="min-w-0 truncate text-13 leading-5 text-td" title={specs[key]}>
                                {specs[key]}
                            </dd>
                        </div>
                    ))}
                </dl>
            )}
            {(!bom || (entries.length === 0 && !bom.spec)) && <p className="mt-1 text-12 text-muted">暂无规格信息</p>}
            {bom && entries.length === 0 && bom.spec && (
                <p className="mt-1 truncate text-12 text-muted" title={bom.spec}>
                    {bom.spec}
                </p>
            )}
        </div>
    );
}
