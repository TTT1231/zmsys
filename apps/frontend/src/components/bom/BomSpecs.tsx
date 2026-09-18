import { bomComposition } from "@/data/bomComposition";
import type { Bom, BomCategory } from "@/api";
import { cn } from "@/lib/utils";

interface BomSpecsProps {
    bom: Pick<Bom, "name" | "items" | "spec">;
    /** 列表行内紧凑；详情与凭证为两列键值网格（record 贴弹窗字段区排版）。 */
    layout?: "detail" | "list" | "record";
    showIdentity?: boolean;
    categories?: BomCategory[];
}

interface BomSpecsGroup {
    groupKey: string;
    groupName: string;
    names: string[];
}

/** 明细按建档 position 排序，相邻同名分组聚合为一行（多选组可多项）。 */
const groupItems = (items: Bom["items"]): BomSpecsGroup[] => {
    const groups: BomSpecsGroup[] = [];
    for (const item of items) {
        const last = groups.at(-1);
        if (last && last.groupKey === item.groupKey && last.groupName === item.groupName) {
            last.names.push(item.name);
        } else {
            groups.push({ groupKey: item.groupKey, groupName: item.groupName, names: [item.name] });
        }
    }
    return groups;
};

/** 统一呈现建档冻结的物料集合：分组名 + 物料名，目录后续变更不影响此处。 */
export function BomSpecs({ bom, layout = "detail", showIdentity = true, categories }: BomSpecsProps) {
    const compact = layout === "list";
    const record = layout === "record";
    const composition = bomComposition(bom, categories);

    const renderItems = (items: Bom["items"]) => {
        const groups = groupItems(items);
        return groups.length > 0 ? (
            compact ? (
                <ul className="flex flex-wrap gap-1.5">
                    {groups.map((group, index) => (
                        <li
                            key={`${group.groupKey}-${index}`}
                            className="max-w-full rounded-md bg-soft px-2 py-1 text-13 leading-5 text-td wrap-anywhere"
                        >
                            <span className="text-muted">{group.groupName}：</span>
                            {group.names.join("、")}
                        </li>
                    ))}
                </ul>
            ) : (
                <dl className={cn("grid grid-cols-2 gap-x-4", record ? "gap-y-2.5" : "gap-y-3.5")}>
                    {groups.map((group, index) => (
                        <div key={`${group.groupKey}-${index}`} className="min-w-0">
                            <dt
                                className={cn(
                                    "text-12 leading-5 wrap-anywhere",
                                    record
                                        ? "text-muted"
                                        : "w-fit max-w-full rounded-sm bg-slate-100 px-1.5 py-0.25 font-medium text-td",
                                )}
                            >
                                {group.groupName}
                            </dt>
                            <dd
                                className={cn(
                                    "mt-1 whitespace-pre-wrap leading-6 text-td wrap-anywhere",
                                    record ? "text-13" : "text-15",
                                )}
                            >
                                {group.names.join("、")}
                            </dd>
                        </div>
                    ))}
                </dl>
            )
        ) : (
            <p className="text-14 leading-6 text-td wrap-anywhere">{bom.spec?.trim() ? bom.spec : "暂无物料信息"}</p>
        );
    };
    return (
        <div className="min-w-0 text-left">
            {showIdentity && (
                <div className={cn("mb-3 flex flex-wrap items-center gap-2", !record && "border-b border-line pb-3")}>
                    <span className="text-12 text-muted">品类</span>
                    <span className="text-13 text-td">{bom.name}</span>
                </div>
            )}
            {composition.composite && (bom.items?.length ?? 0) > 0 ? (
                <div className="space-y-3">
                    {composition.sections.map(section => (
                        <section
                            key={section.key}
                            aria-label={section.title}
                            className={cn(
                                "rounded-input border border-line p-3",
                                section.key === "body" ? "bg-white" : "bg-primary-soft/30",
                            )}
                        >
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                                <h4 className="text-13 font-semibold text-ink">{section.title}</h4>
                                <span className="text-12 text-muted">{section.items.length} 项物料</span>
                            </div>
                            {section.note && <p className="mb-3 text-12 leading-5 text-muted">{section.note}</p>}
                            {section.items.length ? (
                                renderItems(section.items)
                            ) : (
                                <p className="text-13 text-muted">未记录本体物料</p>
                            )}
                        </section>
                    ))}
                </div>
            ) : (
                renderItems(bom.items ?? [])
            )}
        </div>
    );
}
