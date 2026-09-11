import { describe, expect, it } from "vitest";

import type { Bom } from "@/api";
import {
    EMPTY_BOM_SPEC_VALUE,
    bomFieldOptions,
    bomSelectorOptionLabel,
    buildBomSelectorSchema,
    filterBomsBySelections,
    resolveBomSelection,
} from "@/data/bomSelection";

const bom = (code: string, modelCode: string, specs: Record<string, string>): Bom => ({
    code,
    name: "老微动",
    modelCode,
    specs,
    spec: "",
    created: "2026-09-10",
    unit: "个",
});

const oldSwitches = ["带CB", "不带CB"].flatMap(base =>
    ["8.5mm", "8.9mm", "9.6mm"].flatMap(button =>
        ["0.25", "0.27"].map((spring, index) =>
            bom(`${base}-${button}-${index}`, "KW16", {
                底座: base,
                按钮: button,
                弹簧: spring,
                支架: "6.3镀银",
                静片: "6.3镀银",
                弹片: "0.12",
            }),
        ),
    ),
);

describe("BOM cascading selection", () => {
    it("turns the 12 old-switch BOMs into three component choices", () => {
        const schema = buildBomSelectorSchema(oldSwitches, ["底座", "按钮", "弹簧", "支架", "静片", "弹片"]);
        expect(schema.fields.filter(field => field.kind === "spec").map(field => field.label)).toEqual([
            "底座",
            "按钮",
            "弹簧",
        ]);
        expect(schema.fixedSpecs).toEqual([
            { key: "支架", value: "6.3镀银" },
            { key: "静片", value: "6.3镀银" },
            { key: "弹片", value: "0.12" },
        ]);

        const first = resolveBomSelection(oldSwitches, schema.fields, {});
        expect(first.steps).toHaveLength(1);
        expect(first.steps[0]!.options).toEqual(["带CB", "不带CB"]);

        const second = resolveBomSelection(oldSwitches, schema.fields, { "spec:底座": "带CB" });
        expect(second.steps.map(step => step.field.label)).toEqual(["底座", "按钮"]);
        expect(second.steps[1]!.options).toEqual(["8.5mm", "8.9mm", "9.6mm"]);

        const third = resolveBomSelection(oldSwitches, schema.fields, {
            "spec:底座": "带CB",
            "spec:按钮": "8.5mm",
        });
        expect(third.steps.map(step => step.field.label)).toEqual(["底座", "按钮", "弹簧"]);
        expect(third.steps[2]!.options).toEqual(["0.25", "0.27"]);

        const done = resolveBomSelection(oldSwitches, schema.fields, {
            "spec:底座": "带CB",
            "spec:按钮": "8.5mm",
            "spec:弹簧": "0.25",
        });
        expect(done.pending).toBe(false);
        expect(done.candidates).toHaveLength(1);
    });

    it("stops once an earlier choice already identifies a BOM", () => {
        const rows = [
            bom("KQ-1", "KQ", { 类型: "四键焊线", 弹簧: "0.3" }),
            bom("KQ-2", "KQ", { 类型: "四键插线", 弹簧: "0.35" }),
        ];
        const schema = buildBomSelectorSchema(rows, ["类型", "弹簧"]);
        const result = resolveBomSelection(rows, schema.fields, { "spec:类型": "四键焊线" });
        expect(result.pending).toBe(false);
        expect(result.steps.map(step => step.field.label)).toEqual(["类型"]);
        expect(result.candidates[0]!.code).toBe("KQ-1");
    });

    it("supports missing values and uses model/code only as fallbacks", () => {
        const rows = [bom("A", "M1", { 方向: "" }), bom("B", "M2", { 方向: "正面" })];
        const schema = buildBomSelectorSchema(rows, ["方向"]);
        expect(schema.fields.map(field => field.label)).toEqual(["方向", "型号", "BOM 编码"]);
        expect(bomSelectorOptionLabel(EMPTY_BOM_SPEC_VALUE)).toBe("未填写");

        const result = resolveBomSelection(rows, schema.fields, { "spec:方向": EMPTY_BOM_SPEC_VALUE });
        expect(result.pending).toBe(false);
        expect(result.steps.map(step => step.field.label)).toEqual(["方向"]);
        expect(result.candidates[0]!.code).toBe("A");
    });

    it("narrows the static-plate choices to the bracket gauge", () => {
        const rows = [
            bom("KW-63-1", "KW", { 底座: "二脚底座（无挡脚）", 支架: "6.3支架：铜镀银", 静片: "6.3静片：铜镀银" }),
            bom("KW-63-2", "KW", { 底座: "二脚底座（无挡脚）", 支架: "6.3支架：铜镀银", 静片: "6.3静片：铜镀镍" }),
            bom("KW-48-1", "KW", { 底座: "二脚底座（无挡脚）", 支架: "4.8支架：铜镀镍", 静片: "4.8静片：铜镀镍" }),
            bom("KW-48-2", "KW", { 底座: "二脚底座（无挡脚）", 支架: "4.8支架：铜镀镍", 静片: "4.8静片：复合铜镀镍" }),
        ];
        const schema = buildBomSelectorSchema(rows, ["底座", "支架", "静片"]);
        const result = resolveBomSelection(rows, schema.fields, { "spec:支架": "6.3支架：铜镀银" });
        const staticPlateStep = result.steps.find(step => step.field.label === "静片");
        expect(staticPlateStep?.options).toEqual(["6.3静片：铜镀银", "6.3静片：铜镀镍"]);
    });
});

describe("BOM one-shot selection (quick find)", () => {
    const specFieldsOf = (rows: Bom[], preferred: string[]) =>
        buildBomSelectorSchema(rows, preferred).fields.filter(field => field.kind === "spec");

    it("keeps every option of a field visible regardless of the current selections", () => {
        const fields = specFieldsOf(oldSwitches, ["底座", "按钮", "弹簧", "支架", "静片", "弹片"]);
        expect(fields.map(field => field.label)).toEqual(["底座", "按钮", "弹簧"]);
        expect(Object.fromEntries(fields.map(field => [field.label, bomFieldOptions(oldSwitches, field)]))).toEqual({
            底座: ["带CB", "不带CB"],
            按钮: ["8.5mm", "8.9mm", "9.6mm"],
            弹簧: ["0.25", "0.27"],
        });
    });

    it("filters candidates by every selection at once, independent of pick order", () => {
        const fields = specFieldsOf(oldSwitches, ["底座", "按钮", "弹簧"]);
        expect(filterBomsBySelections(oldSwitches, fields, {})).toHaveLength(12);
        expect(
            filterBomsBySelections(oldSwitches, fields, { "spec:按钮": "8.5mm", "spec:底座": "带CB" }).map(
                item => item.code,
            ),
        ).toEqual(["带CB-8.5mm-0", "带CB-8.5mm-1"]);
        expect(
            filterBomsBySelections(oldSwitches, fields, {
                "spec:弹簧": "0.27",
                "spec:底座": "带CB",
                "spec:按钮": "8.9mm",
            }).map(item => item.code),
        ).toEqual(["带CB-8.9mm-1"]);
        expect(filterBomsBySelections(oldSwitches, fields, { "spec:按钮": "10mm" })).toHaveLength(0);
    });

    it("treats missing spec values as a regular selectable option", () => {
        const rows = [bom("A", "M1", { 方向: "" }), bom("B", "M2", { 方向: "正面" })];
        const fields = specFieldsOf(rows, ["方向"]);
        expect(bomFieldOptions(rows, fields[0]!)).toEqual([EMPTY_BOM_SPEC_VALUE, "正面"]);
        expect(
            filterBomsBySelections(rows, fields, { "spec:方向": EMPTY_BOM_SPEC_VALUE }).map(item => item.code),
        ).toEqual(["A"]);
    });
});
