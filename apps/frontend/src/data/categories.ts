/* 开发期 BOM 品类种子：真实后端以 bom_category + GET /bom-categories 为权威来源。
 * mock 用本文件播种接口；前端不得把这里的值当成绕过服务端校验的依据。
 * - 编码规则：ZM + 品类码 + 序号（宽度见 seqWidth，默认 3 位），如 ZMXK2001（旋转）、ZMXK3001（XK3）、ZMKW0001（新微动，4 位）、ZMKW16001（老微动）、ZMKQ001（琴键）。
 * - defaultValue：品类常量属性（固定部件构成），新建时自动并入档，不参与规格摘要。
 * - initial：已知规格的历史推荐值，仅作元数据保留。 */
import type { BomCategory, BomSpecField } from "@/api";

export type SpecFieldDef = BomSpecField;
export type CategoryDef = BomCategory;

/* 新微动：支架与静片各只装 1 个，6.3 / 4.8 是互斥规格；值中保留规格与镀层，便于级联筛选。 */
export const NEW_MICRO_SWITCH_BRACKET_OPTIONS = [
    "6.3支架：铜镀银",
    "6.3支架：铜镀镍",
    "6.3支架：复合铜镀镍",
    "4.8支架：铜镀镍",
    "4.8支架：复合铜镀镍",
];

export const NEW_MICRO_SWITCH_STATIC_PLATE_OPTIONS = [
    "6.3静片：铜镀银",
    "6.3静片：铜镀镍",
    "6.3静片：复合铜镀镍",
    "4.8静片：铜镀镍",
    "4.8静片：复合铜镀镍",
];

export function newMicroSwitchGaugeOf(value: string | undefined): "6.3" | "4.8" | undefined {
    const gauge = value?.trim().match(/^(6\.3|4\.8)/)?.[1];
    return gauge === "6.3" || gauge === "4.8" ? gauge : undefined;
}

export const BOM_CATEGORIES: CategoryDef[] = [
    {
        key: "rotary-switch",
        name: "旋转开关",
        codePrefix: "XK2",
        fields: [
            {
                key: "脚位",
                label: "脚位",
                type: "select",
                options: ["二脚", "三脚", "四脚", "五脚", "六脚"],
                required: true,
            },
            {
                key: "档位",
                label: "档位",
                type: "select",
                options: ["一档", "两档", "三档", "四档", "五档", "六档", "八档"],
                required: true,
            },
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
        key: "xk3",
        name: "XK3",
        codePrefix: "XK3",
        fields: [
            {
                key: "外壳",
                label: "外壳",
                type: "select",
                options: [
                    "圆孔长外壳（茶色）",
                    "圆孔长外壳（透明）",
                    "圆孔短外壳（茶色）",
                    "椭圆孔长外壳无CB字（茶色）",
                    "无耳外壳无CB字（茶色）",
                ],
                required: true,
            },
            { key: "底座", label: "底座", type: "select", options: ["茶色", "透明"], required: true },
            {
                key: "杆子",
                label: "杆子",
                type: "select",
                options: ["圆轴长杆子", "圆轴短杆子", "扁轴4.8", "扁轴4.8转90°"],
                required: true,
            },
            { key: "小静片", label: "小静片", type: "select", options: ["不电镀", "镀锡"], required: true },
            { key: "半圆静片", label: "半圆静片", type: "select", options: ["不电镀", "镀锡"], required: true },
            { key: "动片", label: "动片", type: "select", options: ["不电镀", "镀锡"], required: true },
            { key: "卡线片", label: "卡线片", type: "select", options: ["0.15", "0.2"], required: true },
            { key: "弹簧", label: "弹簧", type: "select", options: ["0.45长弹簧", "0.45短弹簧"], required: true },
            { key: "带圈动片", label: "带圈动片", type: "text", defaultValue: "不电镀" },
            { key: "钢球", label: "钢球", type: "text", defaultValue: "4.0mm电镀钢球" },
        ],
    },
    {
        key: "new-micro-switch",
        name: "新微动",
        codePrefix: "KW",
        seqWidth: 4,
        fields: [
            {
                key: "底座",
                label: "底座",
                type: "select",
                options: ["二脚底座（无挡脚）", "三脚底座（有挡脚）"],
                required: true,
            },
            // 盖子是所有新微动开关都装的固定塑料件，无规格分支
            { key: "盖子", label: "盖子", type: "text", defaultValue: "盖子" },
            {
                key: "按钮高度",
                label: "按钮高度",
                type: "select",
                options: ["7.6mm（常用装跌倒）", "8.0mm", "8.1mm", "8.2mm圆弧", "8.3mm", "8.5mm", "8.8mm", "9.1mm"],
                required: true,
            },
            {
                key: "支架",
                label: "支架",
                type: "select",
                options: NEW_MICRO_SWITCH_BRACKET_OPTIONS,
                required: true,
            },
            {
                key: "静片",
                label: "静片",
                type: "select",
                options: NEW_MICRO_SWITCH_STATIC_PLATE_OPTIONS,
                required: true,
            },
            { key: "动片", label: "动片", type: "select", options: ["铜镀银", "镀锡"], required: true },
            {
                key: "摆片",
                label: "摆片",
                type: "select",
                options: ["铜镀银摆片", "铁镀镍摆片", "复合铜镀镍摆片"],
                required: true,
            },
            { key: "弹片", label: "弹片", type: "select", options: ["0.12", "0.15", "0.2"], required: true },
        ],
    },
    {
        key: "old-micro-switch",
        name: "老微动",
        codePrefix: "KW16",
        fields: [
            { key: "底座", label: "底座", type: "select", options: ["带CB", "不带CB"], required: true },
            {
                key: "按钮",
                label: "按钮",
                type: "select",
                options: ["8.5mm（常用装跌倒）", "8.9mm", "9.6mm"],
                required: true,
            },
            { key: "弹簧", label: "弹簧", type: "select", options: ["0.25", "0.27"], initial: "0.25" },
            { key: "支架", label: "支架", type: "text", defaultValue: "6.3镀银" },
            { key: "静片", label: "静片", type: "text", defaultValue: "6.3镀银" },
            { key: "弹片", label: "弹片", type: "text", defaultValue: "0.12" },
        ],
    },
    {
        key: "piano-key-switch",
        name: "琴键开关",
        codePrefix: "KQ",
        fields: [
            {
                key: "类型",
                label: "类型",
                type: "select",
                options: [
                    "四键焊线",
                    "四键插线",
                    "小太阳四键三档（摇头）",
                    "小太阳四键二档（不摇头）",
                    "冷风扇琴键（茶色）",
                    "冷风扇琴键（透明大功率带触点）",
                ],
                required: true,
            },
            {
                key: "卡板",
                label: "卡板",
                type: "select",
                options: ["大卡板18mm+小卡板18mm+短卡板16mm", "小卡板18mm+短卡板16mm", "小卡板18mm+大卡板18mm"],
            },
            { key: "弹簧", label: "弹簧", type: "select", options: ["0.3", "0.35"] },
            { key: "触点", label: "触点", type: "select", options: ["带点", "不带点"] },
            {
                key: "五金件明细",
                label: "五金件明细",
                type: "text",
                placeholder: "如 扣板×2+连锁片+带点静片+带点动片（数量 1 省略不写）",
            },
        ],
    },
];

export const categoryOf = (name: string) => BOM_CATEGORIES.find(category => category.name === name);

/* 品类常量（defaultValue 字段），新建/种子数据并入 specs */
export const defaultsOf = (category: CategoryDef) =>
    Object.fromEntries(
        category.fields
            .filter(field => field.defaultValue !== undefined)
            .map(field => [field.key, field.defaultValue!]),
    );

/* 模板推荐值（defaultValue + initial）；不限制新建 BOM 的自由规格 */
export const initialValuesOf = (category: CategoryDef) =>
    Object.fromEntries(
        category.fields
            .filter(field => field.defaultValue !== undefined || field.initial !== undefined)
            .map(field => [field.key, (field.initial ?? field.defaultValue)!]),
    );

/* 生成下一个 BOM 编码：ZM + 品类码 + 序号（按品类过滤后在品类内自增，宽度取 seqWidth）。
 * 品类由调用方传入（页面用接口下发的 bomCategories），本文件不再回查种子常量。 */
export function nextBomCode(category: CategoryDef, existing: Array<{ code: string; name: string }>) {
    const prefix = `ZM${category.codePrefix}`;
    // 先按品类过滤再解析 3 位以上序号：跨品类前缀相近（ZMKW/ZMKW16）与跨 999 边界（ZMKW1000+）都不会误读
    const pattern = new RegExp(`^${prefix}(\\d{3,})$`);
    const maxSeq = existing.reduce((max, item) => {
        if (item.name !== category.name) return max;
        const match = pattern.exec(item.code);
        return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `${prefix}${String(maxSeq + 1).padStart(category.seqWidth ?? 3, "0")}`;
}
