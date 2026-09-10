import type { Bom } from "@/api";

export const EMPTY_BOM_SPEC_VALUE = "__ZM_EMPTY_BOM_SPEC_VALUE__";

export interface BomSelectorField {
    id: string;
    label: string;
    kind: "spec" | "model" | "code";
    specKey?: string;
}

export interface BomSelectorSchema {
    fields: BomSelectorField[];
    fixedSpecs: Array<{ key: string; value: string }>;
}

export interface BomSelectionStep {
    field: BomSelectorField;
    options: string[];
}

export interface BomSelectionResolution {
    steps: BomSelectionStep[];
    candidates: Bom[];
    pending: boolean;
}

const clean = (value: string | undefined) => value?.trim() ?? "";

const unique = (values: string[]) => [...new Set(values)];

export function bomSelectorValue(bom: Bom, field: BomSelectorField) {
    const value =
        field.kind === "spec"
            ? clean(bom.specs[field.specKey!])
            : field.kind === "model"
              ? clean(bom.modelCode)
              : clean(bom.code);
    return value || EMPTY_BOM_SPEC_VALUE;
}

export function bomSelectorOptionLabel(value: string) {
    return value === EMPTY_BOM_SPEC_VALUE ? "未填写" : value;
}

/**
 * 从真实 BOM 快照中派生可区分维度：同品类完全相同的规格是固定项，不要求重复选择。
 * preferredSpecKeys 只负责稳定字段顺序；后续自由添加的新规格仍会自动补入。
 */
export function buildBomSelectorSchema(boms: Bom[], preferredSpecKeys: string[] = []): BomSelectorSchema {
    const observedKeys: string[] = [];
    const observed = new Set<string>();
    for (const bom of boms) {
        for (const key of Object.keys(bom.specs)) {
            if (observed.has(key)) continue;
            observed.add(key);
            observedKeys.push(key);
        }
    }

    const orderedKeys = [
        ...preferredSpecKeys.filter(key => observed.has(key)),
        ...observedKeys.filter(key => !preferredSpecKeys.includes(key)),
    ];
    const fields: BomSelectorField[] = [];
    const fixedSpecs: Array<{ key: string; value: string }> = [];

    for (const key of orderedKeys) {
        const values = unique(boms.map(bom => clean(bom.specs[key]) || EMPTY_BOM_SPEC_VALUE));
        if (values.length > 1) {
            fields.push({ id: `spec:${key}`, label: key, kind: "spec", specKey: key });
        } else if (values[0] && values[0] !== EMPTY_BOM_SPEC_VALUE) {
            fixedSpecs.push({ key, value: values[0] });
        }
    }

    if (unique(boms.map(bom => clean(bom.modelCode) || EMPTY_BOM_SPEC_VALUE)).length > 1) {
        fields.push({ id: "modelCode", label: "型号", kind: "model" });
    }
    if (boms.length > 1) fields.push({ id: "bomCode", label: "BOM 编码", kind: "code" });

    return { fields, fixedSpecs };
}

/**
 * 逐级收窄候选项。每轮只暴露当前仍有区分度的下一项；一旦唯一命中，后续冗余字段不再要求选择。
 */
export function resolveBomSelection(
    boms: Bom[],
    fields: BomSelectorField[],
    selections: Record<string, string>,
): BomSelectionResolution {
    let candidates = boms;
    const steps: BomSelectionStep[] = [];

    for (const field of fields) {
        const options = unique(candidates.map(bom => bomSelectorValue(bom, field)));
        if (options.length <= 1) continue;

        steps.push({ field, options });
        const selected = selections[field.id];
        if (!selected || !options.includes(selected)) return { steps, candidates, pending: true };
        candidates = candidates.filter(bom => bomSelectorValue(bom, field) === selected);
    }

    return { steps, candidates, pending: false };
}
