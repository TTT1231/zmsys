import type { Bom } from "@/api";

/** 仅决定列表摘要的优先级，不参与物料校验或编码规则；完整冻结清单始终可展开。 */
const SUMMARY_GROUPS: Record<string, string[]> = {
    旋转XK2: ["model", "spec", "direction", "shell"],
    旋转XK3: ["pc-shell", "pc-base", "pa66-lever"],
    新微动: ["base", "button", "contact-kind"],
    老微动: ["base", "button", "contact-kind"],
    安全开关: ["pc-shell", "contact-kind", "contact-size"],
    跌倒开关: ["tipover-cover", "base", "button"],
    琴键开关: ["piano-base", "piano-cover", "clamp-plate"],
};

export function bomSummary(bom: Pick<Bom, "name" | "items" | "spec">): string {
    const items = bom.items ?? [];
    const priority = SUMMARY_GROUPS[bom.name] ?? [];
    const matchingKeys = priority.filter(key => items.some(item => item.groupKey === key));
    const keys = matchingKeys.length ? matchingKeys : [...new Set(items.map(item => item.groupKey))].slice(0, 2);
    const summary = keys
        .map(key => {
            const group = items.filter(item => item.groupKey === key);
            const nameOf = (item: (typeof items)[number]) =>
                `${item.name}${(item.quantity ?? 1) > 1 ? ` ×${item.quantity}` : ""}`;
            return `${group[0].groupName}：${group.map(nameOf).join("、")}`;
        })
        .join(" · ");
    return summary || bom.spec?.trim() || "暂无物料信息";
}
