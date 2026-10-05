export const num = (value: number) => value.toLocaleString("zh-CN");
/** 千位分隔符会拉宽数字并诱发弹窗表格换行，工作台口径原值直出（5000 而非 5,000）。 */
export const plainNum = (value: number) => `${value}`;
