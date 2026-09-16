/** 历史导入的占位文字不属于地址；只处理完整占位值，不改写真实地名。 */
export const cleanAddressPart = (value?: string | null) => {
    const text = value?.trim() ?? "";
    return ["待补充", "未填写", "暂无", "—", "-"].includes(text) ? "" : text;
};

/** 拼接展示：广东省 深圳市 南山区 粤海街道（跳过空段与历史占位符） */
export const regionText = (region: {
    province?: string | null;
    city?: string | null;
    district?: string | null;
    town?: string | null;
}) => [region.province, region.city, region.district, region.town].map(cleanAddressPart).filter(Boolean).join(" ");
