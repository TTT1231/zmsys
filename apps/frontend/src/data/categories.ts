/* 品类模板（方案 A）：产品规格极少变化，直接维护前端常量，不落库。
 * - 编码规则：ZM + 品类码 + 3 位序号，如 ZMXK001（旋转）、ZMKW001（微动）、ZMDD001（跌倒）。
 * - defaultValue：品类常量属性，新建时预填并入档，不参与规格摘要。
 * - initial：新建表单的推荐初值，可修改，参与规格摘要。 */
export interface SpecFieldDef {
  key: string;
  label: string;
  type: "select" | "text";
  options?: string[];
  required?: boolean;
  placeholder?: string;
  initial?: string;
  defaultValue?: string;
}

export interface CategoryDef {
  name: string;
  codePrefix: string;
  fields: SpecFieldDef[];
}

export const BOM_CATEGORIES: CategoryDef[] = [
  {
    name: "旋转开关",
    codePrefix: "XK",
    fields: [
      { key: "脚位", label: "脚位", type: "select", options: ["二脚", "三脚", "四脚", "五脚", "六脚"], required: true },
      { key: "档位", label: "档位", type: "select", options: ["一档", "两档", "三档", "四档", "五档", "六档", "八档"], required: true },
      { key: "规格", label: "规格", type: "text", placeholder: "如 222-1" },
      { key: "方向", label: "方向", type: "text", placeholder: "如 正面" },
      { key: "银点厚度", label: "银点厚度", type: "select", options: ["0.2", "0.3"], initial: "0.2" },
      { key: "弹簧", label: "弹簧", type: "select", options: ["0.5", "0.55", "0.6"], initial: "0.5" },
      { key: "杆子高度", label: "杆子高度", type: "text", defaultValue: "4.8" },
      { key: "A面触点", label: "A面触点", type: "text", defaultValue: "A面银点" },
      { key: "B面触点", label: "B面触点", type: "text", defaultValue: "B面塑料盖板" },
    ],
  },
  {
    name: "微动开关",
    codePrefix: "KW",
    fields: [
      { key: "触点形式", label: "触点形式", type: "select", options: ["常开", "常闭", "转换"], required: true },
      { key: "动作力", label: "动作力", type: "text", placeholder: "如 160gf", required: true },
      { key: "行程", label: "行程", type: "text", placeholder: "如 0.25mm" },
      { key: "额定电流", label: "额定电流", type: "text", placeholder: "如 5A 250VAC" },
    ],
  },
  {
    name: "跌倒开关",
    codePrefix: "DD",
    fields: [
      { key: "感应角度", label: "感应角度", type: "text", placeholder: "如 ±30°", required: true },
      { key: "输出信号", label: "输出信号", type: "select", options: ["常开", "常闭"] },
      { key: "额定电流", label: "额定电流", type: "text", placeholder: "如 2A 30VDC" },
    ],
  },
];

export const categoryOf = (name: string) =>
  BOM_CATEGORIES.find((category) => category.name === name);

/* 品类常量（defaultValue 字段），新建/种子数据并入 specs */
export const defaultsOf = (category: CategoryDef) =>
  Object.fromEntries(
    category.fields
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue!]),
  );

/* 新建表单初值（defaultValue + initial） */
export const initialValuesOf = (category: CategoryDef) =>
  Object.fromEntries(
    category.fields
      .filter((field) => field.defaultValue !== undefined || field.initial !== undefined)
      .map((field) => [field.key, (field.initial ?? field.defaultValue)!]),
  );

/* 生成下一个 BOM 编码：ZM + 品类码 + 3 位序号（序号在各品类内自增） */
export function nextBomCode(name: string, existingCodes: string[]) {
  const category = categoryOf(name);
  if (!category) throw new Error(`未知品类：${name}`);
  const prefix = `ZM${category.codePrefix}`;
  const maxSeq = existingCodes
    .filter((code) => code.startsWith(prefix))
    .reduce((max, code) => Math.max(max, Number(code.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
}
