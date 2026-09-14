import type { Bom, BomCategory } from "@/api";
import { cn } from "@/lib/utils";

interface BomSpecsProps {
    bom: Pick<Bom, "name" | "modelCode" | "specs" | "spec">;
    category?: BomCategory;
    /** 列表只展示区分规格；详情同时展示品类固定项。 */
    layout?: "detail" | "list" | "record";
    showIdentity?: boolean;
}

/** 统一呈现规格键值，保留原值；仅卡板、五金明细按组合部件分行。 */
export function BomSpecs({ bom, category, layout = "detail", showIdentity = true }: BomSpecsProps) {
    const compact = layout === "list";
    const record = layout === "record";
    const fields = category?.name === bom.name ? category.fields : [];
    const keys = [...new Set([...fields.map(field => field.key), ...Object.keys(bom.specs)])];
    const entries = keys
        .filter(key => bom.specs[key]?.trim())
        .map(key => ({ key, value: bom.specs[key], field: fields.find(field => field.key === key) }));
    const fixed = entries.filter(item => item.field?.defaultValue === item.value);
    const variable = entries.filter(item => item.field?.defaultValue !== item.value);

    const renderFields = (items: typeof entries, secondary = false) => (
        <dl
            className={cn(
                "grid grid-cols-2 gap-x-4",
                compact ? "gap-y-2.5 lg:flex lg:flex-wrap lg:gap-x-4 lg:gap-y-1" : "gap-y-3.5",
                record && "flex flex-wrap gap-y-2",
            )}
        >
            {items.map(({ key, value, field }) => {
                const parts =
                    key === "卡板" || key === "五金件明细" ? value.split(/[+＋]/).filter(part => part.trim()) : [];
                // 长值占满一行，避免手机上把尺寸、材质挤进半列；未知字段沿用同一规则。
                const wide = value.length > 12 || key.length > 6 || parts.length > 1;
                return (
                    <div
                        key={key}
                        className={cn(
                            "min-w-0",
                            wide && "col-span-full",
                            record && "flex items-start gap-x-2",
                            record && (wide || key === "类型") && "basis-full",
                            compact && "lg:flex lg:items-baseline lg:gap-x-2",
                            compact &&
                                (key === "类型" || key === "五金件明细" || (wide && parts.length < 2)) &&
                                "lg:basis-full",
                        )}
                    >
                        <dt
                            className={cn(
                                "w-fit max-w-full shrink-0 rounded-sm px-1.5 py-0.25 text-12 font-medium leading-5 wrap-anywhere",
                                secondary ? "bg-white text-muted" : "bg-slate-100 text-td",
                            )}
                        >
                            {field?.label || key}
                        </dt>
                        <dd
                            className={cn(
                                "mt-1 whitespace-pre-wrap wrap-anywhere",
                                compact ? "text-14 leading-6 lg:mt-0 lg:text-13 lg:leading-5" : "text-15 leading-6",
                                record && "mt-0 min-w-0 flex-1 text-14 leading-6",
                                secondary ? "text-muted" : "text-td",
                            )}
                        >
                            {parts.length > 1 ? (
                                <ul className="flex flex-wrap gap-1.5" aria-label={field?.label || key}>
                                    {parts.map((part, index) => (
                                        <li
                                            key={index}
                                            className={cn(
                                                "max-w-full rounded-md bg-soft px-2 py-1",
                                                compact && "lg:rounded-none lg:bg-transparent lg:p-0",
                                                record && "bg-transparent p-0",
                                            )}
                                        >
                                            {(compact || record) && index > 0 && (
                                                <span
                                                    aria-hidden="true"
                                                    className={cn("mr-1.5 text-muted", !record && "hidden lg:inline")}
                                                >
                                                    +
                                                </span>
                                            )}
                                            {part.trim()}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                value
                            )}
                        </dd>
                    </div>
                );
            })}
        </dl>
    );

    return (
        <div className="min-w-0 text-left">
            {showIdentity && (
                <div className={cn("mb-3 flex flex-wrap items-center gap-2", !record && "border-b border-line pb-3")}>
                    <span className="text-12 text-muted">型号</span>
                    <strong className="tnum max-w-full rounded-md bg-primary-soft px-2.5 py-1 text-17 font-semibold text-primary-strong wrap-anywhere">
                        {bom.modelCode || "—"}
                    </strong>
                    <span className="text-13 text-td">{bom.name}</span>
                </div>
            )}
            {renderFields(variable)}
            {entries.length === 0 && (
                <p className="text-14 leading-6 text-td wrap-anywhere">
                    {bom.spec && bom.spec !== bom.modelCode ? bom.spec : "暂无规格信息"}
                </p>
            )}
            {fixed.length > 0 && (!compact || variable.length === 0) && (
                <div className={cn("rounded-btn bg-soft p-3", variable.length > 0 && "mt-3.5")}>
                    <p className="mb-2 text-12 font-medium text-muted">品类固定规格</p>
                    {renderFields(fixed, true)}
                </div>
            )}
        </div>
    );
}
