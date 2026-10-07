import type { Bom, BomCategory } from "@/api";

export interface BomCompositionSection {
    key: string;
    title: string;
    items: Bom["items"];
    note?: string;
}
const BODY_GROUPS = new Set(["tipover-cover", "tipover-base", "steel-ball", "rocker"]);

/* 复合品类子选的叫法（与新建 BOM 的子选标签同口径）：旋转XK3 为焊线工艺（焊线/插线），
 * 跌倒开关为微动开关类型——分节标题与列表行不得把两类混用。
 * section=详情分节前缀（空串=不加前缀，直接以焊线/插线等子品类名作标题），
 * row=列表行前缀，empty=无子件物料时的系列文案。 */
interface ChildKind {
    section: string;
    row: string;
    empty: string;
}
const CHILD_KINDS: Record<string, ChildKind> = {
    旋转XK3: { section: "", row: "焊线工艺", empty: "未记录工艺物料" },
    跌倒开关: { section: "微动开关", row: "微动组件", empty: "未记录微动物料" },
};

/** 目录仅用于识别归属，展示仍使用建档快照；历史/歧义物料不推测系列、不丢弃。 */
export function bomComposition(bom: Pick<Bom, "name" | "items">, categories: BomCategory[] = []) {
    const parent = categories.find(category => category.name === bom.name);
    const composite = !!parent?.childCategories?.length || bom.name === "跌倒开关";
    if (!composite) return { composite: false, childKind: "", series: "", sections: [] as BomCompositionSection[] };
    const kind = CHILD_KINDS[bom.name] ?? { section: "子件", row: "子件", empty: "未记录子件物料" };
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
    /* 旋转XK3 主品类无自有目录（物料全在焊线工艺子品类），不输出空的本体节 */
    const sections: BomCompositionSection[] =
        body.length || !parent || parent.groups.length ? [{ key: "body", title: `${bom.name}本体`, items: body }] : [];
    const seriesNames: string[] = [];
    const sectionPrefix = kind.section ? `${kind.section} · ` : "";
    for (const [key, items] of buckets) {
        const name = children.find(category => category.key === key)?.name;
        if (name) seriesNames.push(name);
        sections.push({
            key,
            title: `${sectionPrefix}${name ?? "系列待确认"}`,
            items,
            ...(name ? {} : { note: "当前目录无法唯一确认这些历史物料的系列，以下保留建档时的原始明细。" }),
        });
    }
    const series = !buckets.size ? kind.empty : buckets.has("unknown") ? "系列待确认" : seriesNames.join(" / ");
    return { composite: true, childKind: kind.row, series, sections };
}
