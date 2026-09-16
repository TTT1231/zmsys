import type { Bom, BomCategory } from "@/api";

export interface BomCompositionSection {
    key: string;
    title: string;
    items: Bom["items"];
    note?: string;
}
const BODY_GROUPS = new Set(["tipover-cover", "tipover-base", "steel-ball", "rocker"]);

/** 目录仅用于识别归属，展示仍使用建档快照；历史/歧义物料不推测系列、不丢弃。 */
export function bomComposition(bom: Pick<Bom, "name" | "items">, categories: BomCategory[] = []) {
    const parent = categories.find(category => category.name === bom.name);
    const composite = !!parent?.childCategories?.length || bom.name === "跌倒开关";
    if (!composite) return { composite: false, series: "", sections: [] as BomCompositionSection[] };
    const bodyIds = new Set(parent?.groups.flatMap(group => group.items.map(item => item.id)) ?? []);
    const children = categories.filter(category => parent?.childCategories?.includes(category.key));
    const bodyGroups = new Set(parent?.groups.flatMap(group => (group.key ? [group.key] : [])) ?? BODY_GROUPS);
    const childGroups = new Set(
        children.flatMap(category => category.groups.flatMap(group => (group.key ? [group.key] : []))),
    );
    const childIds = new Map(
        children.map(category => [
            category.key,
            new Set(category.groups.flatMap(group => group.items.map(item => item.id))),
        ]),
    );
    const body: Bom["items"] = [];
    const buckets = new Map<string, Bom["items"]>();
    for (const item of bom.items ?? []) {
        if (bodyIds.has(item.materialId)) {
            body.push(item);
            continue;
        }
        const matches = children.filter(category => childIds.get(category.key)?.has(item.materialId));
        if (!matches.length && bodyGroups.has(item.groupKey) && !childGroups.has(item.groupKey)) {
            body.push(item);
            continue;
        }
        const key = matches.length === 1 ? matches[0].key : "unknown";
        buckets.set(key, [...(buckets.get(key) ?? []), item]);
    }
    const sections: BomCompositionSection[] = [{ key: "body", title: `${bom.name}本体`, items: body }];
    const seriesNames: string[] = [];
    for (const [key, items] of buckets) {
        const name = children.find(category => category.key === key)?.name;
        if (name) seriesNames.push(name);
        sections.push({
            key,
            title: name ? `微动开关 · ${name}` : "微动开关 · 系列待确认",
            items,
            ...(name ? {} : { note: "当前目录无法唯一确认这些历史物料的系列，以下保留建档时的原始明细。" }),
        });
    }
    const series = !buckets.size ? "未记录微动物料" : buckets.has("unknown") ? "系列待确认" : seriesNames.join(" / ");
    return { composite: true, series, sections };
}
