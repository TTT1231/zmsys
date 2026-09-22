/* 开发期 BOM 物料目录种子：真实后端以 material_group/material_item 表 +
 * GET /bom-categories 为权威来源。mock 用本文件播种接口；前端不得把这里的值
 * 当成绕过服务端校验的依据。
 * - 编码规则：品类前缀 + 序号（宽度见 seqWidth，默认 3 位），如 XK2001（旋转XK2）、KWO001（老微动）、KW001（新微动）、KQ001（琴键开关）。
 * - 目录为“分区 → 分组 → 物料”树：分区纯展示；分组带 key 与单选/多选语义；
 *   qty 分组（如琴键开关的扣板/连锁片/静片/动片）选中项可携带 1-99 数量；
 *   所有组皆可不选（客户决定要不要 A 面这类项），整份 BOM 至少选 1 项。
 * - 系统共 7 品类：旋转XK2 / 旋转XK3 / 新微动 / 老微动 / 安全开关 / 跌倒开关 / 琴键开关。
 * - 跌倒开关为嵌套档：建档必须额外选择一个新微动/老微动 BOM 作为子件（childCategories 标记）。 */
import type { BomCatalogNode, BomCategory } from "@/api";

export type CatalogNodeDef = BomCatalogNode;
export type CategoryDef = BomCategory;

const group = (
    id: string,
    name: string,
    key: string,
    parentId: string | null,
    items: Array<[string, string]>,
): BomCatalogNode => ({
    id,
    parentId,
    kind: "group",
    name,
    key,
    multi: false,
    qty: false,
    items: items.map(([itemId, itemName]) => ({ id: itemId, name: itemName })),
});

const section = (id: string, name: string): BomCatalogNode => ({
    id,
    parentId: null,
    kind: "section",
    name,
    key: null,
    multi: null,
    qty: null,
    items: [],
});

const multiGroup = (
    id: string,
    name: string,
    key: string,
    parentId: string | null,
    items: Array<[string, string]>,
): BomCatalogNode => ({
    ...group(id, name, key, parentId, items),
    multi: true,
});

/* 数量分组：单选 + 勾选后可选数量（1-99 步进器） */
const qtyGroup = (
    id: string,
    name: string,
    key: string,
    parentId: string | null,
    items: Array<[string, string]>,
): BomCatalogNode => ({
    ...group(id, name, key, parentId, items),
    qty: true,
});

/* 多选数量分组：可选多项，每个选中项各带 1-99 数量（琴键开关静片/动片） */
const multiQtyGroup = (
    id: string,
    name: string,
    key: string,
    parentId: string | null,
    items: Array<[string, string]>,
): BomCatalogNode => ({
    ...qtyGroup(id, name, key, parentId, items),
    multi: true,
});

export const BOM_CATEGORIES: CategoryDef[] = [
    {
        key: "rotary-switch",
        name: "旋转XK2",
        codePrefix: "XK2",
        groups: [
            group("2001", "型号", "model", null, [
                ["3051", "0-2"],
                ["3052", "0-3"],
                ["3053", "0-4"],
                ["3054", "0-4-1"],
                ["3055", "0-5"],
                ["3056", "0-6"],
                ["3057", "0-7"],
                ["3058", "0-8"],
                ["3059", "0-9"],
                ["3001", "1-1"],
                ["3002", "2-1"],
                ["3060", "2-2"],
                ["3061", "3-1"],
                ["3062", "3-2"],
                ["3063", "4-1"],
                ["3064", "4-2"],
                ["3065", "4-3"],
                ["3066", "4-4"],
                ["3067", "4-8"],
                ["3068", "4-9"],
                ["3069", "无"],
            ]),
            group("2008", "规格", "spec", null, [
                ["3071", "211-1"],
                ["3072", "222-1"],
                ["3073", "2-1-4"],
                ["3074", "222-2"],
                ["3075", "233-4"],
                ["3076", "233-1-B"],
                ["3077", "233-1"],
                ["3078", "243-1-2"],
                ["3079", "243-5B"],
                ["3080", "243-5A"],
                ["3081", "243-5"],
                ["3082", "243-1"],
                ["3083", "全方位/冷风扇/284-1B"],
                ["3084", "全方位/284-2B"],
                ["3085", "212-1"],
                ["3086", "263-1-A"],
                ["3087", "284-1A"],
                ["3088", "284-2"],
                ["3089", "284-1"],
                ["3090", "284-3"],
                ["3091", "284-4"],
                ["3092", "无"],
            ]),
            group("2009", "方向", "direction", null, [
                ["3093", "正面"],
                ["3094", "反面"],
                ["3095", "正面反轴"],
                ["3096", "反面转90°扁位朝上"],
                ["3097", "正面转90°扁位朝上"],
            ]),
            group("2004", "杆子点位厚度", "lever-point-thickness", null, [
                ["3005", "4.8"],
                ["3023", "4.9"],
            ]),
            group("2005", "A面", "face-a", null, [
                ["3031", "三脚银点"],
                ["3032", "三脚铜点"],
                ["3033", "塑料盖板"],
                ["3034", "全方位左脚银点"],
                ["3036", "左脚银点"],
                ["3037", "右脚银点"],
                ["3038", "右脚铜点"],
                ["3039", "全方位左脚铜点"],
                ["3624", "左脚铜点"],
                ["3750", "全方位双脚铜点"],
                ["3751", "全方位双脚银点"],
            ]),
            group("2006", "B面", "face-b", null, [
                ["3041", "三脚银点"],
                ["3042", "三脚铜点"],
                ["3043", "塑料盖板"],
                ["3044", "全方位左脚银点"],
                ["3046", "左脚银点"],
                ["3047", "右脚银点"],
                ["3048", "右脚铜点"],
                ["3049", "全方位左脚铜点"],
                ["3625", "左脚铜点"],
                ["3752", "全方位双脚铜点"],
                ["3753", "全方位双脚银点"],
            ]),
            group("2007", "弹簧", "spring", null, [
                ["3008", "0.5"],
                ["3009", "0.55"],
                ["3010", "0.6"],
            ]),
            section("2607", "触点"),
            group("2608", "触点大小", "contact-size", "2607", [
                ["3617", "3.0mm"],
                ["3618", "3.5mm"],
            ]),
            group("2609", "触点厚度", "contact-thickness", "2607", [
                ["3619", "0.15"],
                ["3620", "0.2"],
                ["3621", "0.3"],
            ]),
            group("2610", "触点类别", "contact-kind", "2607", [
                ["3622", "铜"],
                ["3623", "银"],
            ]),
        ],
    },
    {
        key: "rotary-xk3",
        name: "旋转XK3",
        codePrefix: "XK3",
        childCategories: ["xk3-wire", "xk3-plug"],
        groups: [],
    },
    {
        key: "xk3-wire",
        name: "焊线",
        codePrefix: "XK3W",
        status: false,
        groups: [
            section("2711", "PC塑料"),
            group("2712", "外壳", "shell", "2711", [["3754", "外壳"]]),
            group("2713", "底座", "base", "2711", [["3755", "底座"]]),
            group("2714", "PA66塑料杆子", "pa66-lever", null, [
                ["3756", "圆轴"],
                ["3757", "扁轴4.8"],
            ]),
            section("2715", "五金件"),
            multiGroup("2716", "静片", "static-plate", "2715", [
                ["3758", "小静片"],
                ["3759", "半圆静片"],
            ]),
            group("2717", "动片", "moving-plate", "2715", [["3760", "带圈动片"]]),
            multiGroup("2718", "弹簧", "spring", "2715", [
                ["3761", "长弹簧"],
                ["3762", "短弹簧"],
            ]),
            group("2719", "钢球", "steel-ball", "2715", [["3763", "3.0mm电镀钢球"]]),
        ],
    },
    {
        key: "xk3-plug",
        name: "插线",
        codePrefix: "XK3P",
        status: false,
        groups: [
            group("2401", "PC塑料外壳", "pc-shell", null, [
                ["3401", "圆孔长外壳（茶色）"],
                ["3402", "圆孔长外壳（透明）"],
                ["3403", "圆孔短外壳（茶色）"],
                ["3404", "椭圆孔长外壳无CB字（茶色）"],
                ["3405", "无耳外壳无CB字（茶色）"],
            ]),
            group("2402", "PC塑料底座", "pc-base", null, [
                ["3406", "底座：茶色"],
                ["3407", "底座：透明"],
            ]),
            group("2403", "PA66塑料杆子", "pa66-lever", null, [
                ["3408", "圆轴长杆子"],
                ["3409", "圆轴短杆子"],
                ["3410", "扁轴4.8"],
                ["3411", "扁轴4.8转90°"],
            ]),
            section("2404", "五金件"),
            group("2411", "小静片", "small-static-plate", "2404", [
                ["3412", "不电镀"],
                ["3413", "镀锡"],
            ]),
            group("2412", "半圆静片", "half-round-static-plate", "2404", [
                ["3414", "不电镀"],
                ["3415", "镀锡"],
            ]),
            group("2413", "动片", "moving-plate", "2404", [
                ["3416", "不电镀"],
                ["3417", "镀锡"],
            ]),
            group("2414", "带圈动片", "ring-moving-plate", "2404", [["3418", "不电镀"]]),
            group("2415", "钢球", "steel-ball", "2404", [["3419", "4.0mm电镀钢球"]]),
            group("2416", "卡线片", "wire-clip", "2404", [
                ["3431", "底0.15 盖0.2"],
                ["3420", "底盖0.15"],
                ["3421", "底盖0.2"],
            ]),
            multiGroup("2417", "弹簧", "spring", "2404", [
                ["3422", "0.45长弹簧"],
                ["3423", "0.45短弹簧"],
            ]),
        ],
    },

    {
        key: "new-micro-switch",
        name: "新微动",
        codePrefix: "KW",
        groups: [
            section("2101", "PA66塑料"),
            group("2111", "底座", "base", "2101", [
                ["3101", "二脚底座（无挡脚）"],
                ["3102", "三脚底座（有挡脚）"],
            ]),
            group("2112", "盖子", "cover", "2101", [["3103", "盖子"]]),
            group("2113", "按钮", "button", "2101", [
                ["3104", "7.6mm（常用装跌倒）"],
                ["3105", "8.0mm"],
                ["3106", "8.1mm"],
                ["3107", "8.2mm圆弧"],
                ["3108", "8.3mm"],
                ["3109", "8.5mm"],
                ["3110", "8.8mm"],
                ["3111", "9.1mm"],
            ]),
            section("2102", "五金件"),
            group("2114", "支架", "bracket", "2102", [
                ["3112", "6.3支架：铜镀银"],
                ["3113", "6.3支架：铜镀镍"],
                ["3114", "6.3支架：复合铜镀镍"],
                ["3115", "4.8支架：铜镀镍"],
                ["3116", "4.8支架：复合铜镀镍"],
            ]),
            group("2115", "静片", "static-plate", "2102", [
                ["3117", "6.3静片：铜镀银"],
                ["3118", "6.3静片：铜镀镍"],
                ["3119", "6.3静片：复合铜镀镍"],
                ["3120", "4.8静片：铜镀镍"],
                ["3121", "4.8静片：复合铜镀镍"],
            ]),
            group("2116", "动片", "moving-plate", "2102", [
                ["3122", "铜镀银"],
                ["3123", "镀锡"],
                ["3138", "铜镀锡"],
            ]),
            group("2117", "摆片", "swing-plate", "2102", [
                ["3124", "铜镀银摆片"],
                ["3125", "铁镀镍摆片"],
                ["3126", "复合铜镀镍摆片"],
            ]),
            group("2118", "弹片", "spring-plate", "2102", [
                ["3127", "0.12"],
                ["3128", "0.15"],
                ["3129", "0.2"],
            ]),
            group("2709", "压杆", "press-rod", "2102", [
                ["3747", "直杆"],
                ["3748", "弯杆"],
            ]),
            section("2103", "触点"),
            group("2119", "触点大小", "contact-size", "2103", [
                ["3131", "3.0mm"],
                ["3132", "3.5mm"],
            ]),
            group("2120", "触点厚度", "contact-thickness", "2103", [
                ["3133", "0.15"],
                ["3134", "0.2"],
                ["3135", "0.3"],
            ]),
            group("2121", "触点类别", "contact-kind", "2103", [
                ["3136", "铜"],
                ["3137", "银"],
            ]),
        ],
    },
    {
        key: "old-micro-switch",
        name: "老微动",
        codePrefix: "KWO",
        groups: [
            section("2201", "PA66塑料"),
            group("2211", "底座", "base", "2201", [
                ["3201", "带CB"],
                ["3202", "不带CB"],
            ]),
            group("2212", "盖子", "cover", "2201", [["3203", "盖子"]]),
            group("2213", "按钮", "button", "2201", [
                ["3204", "8.5mm（常用装跌倒）"],
                ["3205", "8.9mm"],
                ["3206", "9.6mm"],
            ]),
            section("2202", "五金件"),
            group("2214", "支架", "bracket", "2202", [
                ["3207", "6.3镀银支架"],
                ["3213", "6.3复合铜支架"],
            ]),
            group("2215", "静片", "static-plate", "2202", [
                ["3208", "6.3镀银静片"],
                ["3214", "6.3复合铜静片"],
            ]),
            group("2216", "弹片", "spring-plate", "2202", [["3209", "0.12"]]),
            group("2217", "弹簧", "spring", "2202", [
                ["3210", "0.25"],
                ["3211", "0.27"],
            ]),
            group("2218", "挡脚", "stop-foot", "2202", [["3212", "挡脚"]]),
            group("2710", "压杆", "press-rod", "2202", [["3749", "直杆"]]),
            section("2203", "触点"),
            group("2219", "触点大小", "contact-size", "2203", [
                ["3141", "3.0mm"],
                ["3142", "3.5mm"],
            ]),
            group("2220", "触点厚度", "contact-thickness", "2203", [
                ["3143", "0.15"],
                ["3144", "0.2"],
                ["3145", "0.3"],
            ]),
            group("2221", "触点类别", "contact-kind", "2203", [
                ["3146", "铜"],
                ["3147", "银"],
            ]),
        ],
    },
    {
        key: "safety-switch",
        name: "安全开关",
        codePrefix: "AQ",
        groups: [
            group("2501", "PC塑料（外壳类）", "pc-shell", null, [
                ["3501", "安全开关KD-2 (30mm/31mm) 外壳 / 茶色"],
                ["3502", "安全开关KW16 (31mm) 外壳 / 茶色"],
                ["3503", "安全开关KW16 (31mm) 外壳 / 透明"],
                ["3504", "安全开关KD-2 (40mm/43mm) 外壳 / 茶色"],
                ["3505", "安全开关KW16 (43mm) 外壳 / 茶色"],
            ]),
            section("2502", "PA66塑料"),
            group("2511", "盖板", "cover", "2502", [["3506", "盖板"]]),
            section("2503", "五金件"),
            multiGroup("2611", "短款/30mm系列配件", "short-30-parts", "2503", [
                ["3607", "动片"],
                ["3608", "静片"],
                ["3609", "短杆子"],
                ["3610", "短帽子"],
                ["3611", "短弹簧"],
            ]),
            multiGroup("2612", "短款/31mm系列配件", "short-31-parts", "2503", [
                ["3507", "动片"],
                ["3508", "静片"],
                ["3509", "短杆子"],
                ["3510", "短帽子"],
                ["3511", "短弹簧"],
            ]),
            multiGroup("2613", "长款/40mm系列配件", "long-41-parts", "2503", [
                ["3612", "动片"],
                ["3613", "静片"],
                ["3614", "长杆子"],
                ["3615", "长帽子"],
                ["3616", "长弹簧"],
            ]),
            multiGroup("2614", "长款/43mm系列配件", "long-43-parts", "2503", [
                ["3512", "动片"],
                ["3513", "静片"],
                ["3514", "长杆子"],
                ["3515", "长帽子"],
                ["3516", "长弹簧"],
            ]),
            section("2504", "触点"),
            group("2514", "触点大小", "contact-size", "2504", [
                ["3517", "3.0mm"],
                ["3518", "3.5mm"],
            ]),
            group("2515", "触点厚度", "contact-thickness", "2504", [
                ["3519", "0.15"],
                ["3520", "0.2"],
                ["3521", "0.3"],
            ]),
            group("2516", "触点类别", "contact-kind", "2504", [
                ["3522", "铜"],
                ["3523", "银"],
            ]),
        ],
    },
    {
        key: "tipover-switch",
        name: "跌倒开关",
        codePrefix: "KD",
        childCategories: ["new-micro-switch", "old-micro-switch"],
        groups: [
            group("2601", "跌倒盖", "tipover-cover", null, [
                ["3601", "跌倒盖KW16 / 有CB字"],
                ["3602", "跌倒盖KW16 / 无CB字"],
                ["3603", "跌倒盖KB-1"],
            ]),
            group("2602", "跌倒底", "tipover-base", null, [["3604", "跌倒底"]]),
            group("2603", "钢球", "steel-ball", null, [["3605", "18mm钢球"]]),
            group("2604", "翘板", "rocker", null, [["3606", "翘板"]]),
        ],
    },

    {
        key: "piano-key-switch",
        name: "琴键开关",
        codePrefix: "KQ",
        groups: [
            group("2701", "琴键底", "piano-base", null, [
                ["3701", "四键焊线底"],
                ["3702", "四键插线底"],
                ["3703", "五键焊线底"],
                ["3704", "五键插线底"],
                ["3705", "小太阳四键三档底（摇头）茶色"],
                ["3706", "小太阳四键三档底（摇头）灰色"],
                ["3707", "小太阳四键二档底（不摇头）茶色"],
                ["3708", "小太阳四键二档底（不摇头）灰色"],
                ["3709", "冷风扇琴键底（茶色）"],
                ["3710", "冷风扇琴键底（透明）大功率带触点"],
            ]),
            group("2702", "琴键盖", "piano-cover", null, [
                ["3711", "四键焊线盖"],
                ["3712", "四键插线盖"],
                ["3713", "五键焊线盖"],
                ["3714", "五键插线盖"],
                ["3715", "小太阳四键三档盖（摇头）茶色"],
                ["3716", "小太阳四键三档盖（摇头）灰色"],
                ["3717", "小太阳四键二档盖（不摇头）茶色"],
                ["3718", "小太阳四键二档盖（不摇头）灰色"],
                ["3719", "冷风扇琴键盖（茶色）"],
            ]),
            group("2703", "卡板", "clamp-plate", null, [
                ["3720", "大卡板18mm"],
                ["3721", "小卡板18mm"],
                ["3722", "短卡板16mm"],
                ["3723", "小太阳小卡板18mm"],
                ["3724", "小太阳短卡板16mm"],
                ["3725", "冷风扇小卡板18mm"],
                ["3726", "冷风扇大卡板18mm"],
            ]),
            qtyGroup("2704", "扣板", "buckle-plate", null, [
                ["3727", "扣板"],
                ["3728", "四键扣板"],
                ["3729", "五键扣板"],
            ]),
            qtyGroup("2705", "连锁片", "interlock-tab", null, [
                ["3730", "连锁片"],
                ["3731", "四键连锁片"],
                ["3732", "五键连锁片"],
            ]),
            multiQtyGroup("2706", "静片", "static-plate", null, [
                ["3733", "带点静片"],
                ["3734", "不带点静片"],
                ["3735", "四键焊线静片"],
                ["3736", "四键插线静片"],
                ["3737", "五键焊线静片"],
                ["3738", "五键插线静片"],
            ]),
            multiQtyGroup("2707", "动片", "moving-plate", null, [
                ["3739", "带点动片"],
                ["3740", "不带点动片"],
                ["3741", "辅助动片"],
                ["3764", "四键焊线动片"],
                ["3742", "四键插线动片"],
                ["3743", "五键焊线动片"],
                ["3744", "五键插线动片"],
            ]),
            group("2708", "弹簧规格", "spring-spec", null, [
                ["3745", "0.3"],
                ["3746", "0.35"],
            ]),
        ],
    },
];

export const categoryOf = (name: string) => BOM_CATEGORIES.find(category => category.name === name);

/** 目录顺序（分区→组→物料的种子序）拍平的物料行：已选集合的稳定展示序与建档快照序 */
export interface CatalogItemRow {
    id: string;
    groupKey: string;
    groupName: string;
    name: string;
}

export const catalogRowsOf = (category: { groups: BomCatalogNode[] }): CatalogItemRow[] =>
    category.groups.flatMap(node =>
        node.kind === "group"
            ? node.items.map(item => ({ id: item.id, groupKey: node.key!, groupName: node.name, name: item.name }))
            : [],
    );

/** 摘要工具（与后端 bom-display 同构）：“组名：物料名”以 “ · ” 连接 */
export const bomSpecOfItems = (items: Array<{ groupName: string; name: string }>): string =>
    items.map(item => `${item.groupName}：${item.name}`).join(" · ");

/* 生成下一个 BOM 编码：品类前缀 + 序号（按品类过滤后在品类内自增，宽度取 seqWidth）。
 * 品类由调用方传入（页面用接口下发的 bomCategories），本文件不再回查种子常量。 */
export function nextBomCode(category: CategoryDef, existing: Array<{ code: string; name: string }>) {
    const prefix = category.codePrefix;
    // 先按品类过滤再解析 3 位以上序号：跨品类前缀相近（KW/KWO）与跨 999 边界（KW1000+）都不会误读
    const pattern = new RegExp(`^${prefix}(\\d{3,})$`);
    const maxSeq = existing.reduce((max, item) => {
        if (item.name !== category.name) return max;
        const match = pattern.exec(item.code);
        return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `${prefix}${String(maxSeq + 1).padStart(category.seqWidth ?? 3, "0")}`;
}
