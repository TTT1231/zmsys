/* ISO 日期（yyyy-MM-dd）工具：全部按本地时区计算 */
const pad = (value: number) => String(value).padStart(2, "0");

export const toIso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const todayIso = () => toIso(new Date());

/** 北京时区（UTC+8）日历日期：时刻 +8h 后取 UTC 字段即北京墙上时钟。
 *  与后端 beijing-day 口径一致——"当天可作废"等服务端窗口规则的前端判定
 *  必须用北京日期（todayIso 是浏览器本地时区，非北京时区浏览器会错位） */
export const beijingDateOf = (date: Date) => {
    const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
};

export const beijingTodayIso = () => beijingDateOf(new Date());

export const addDays = (isoDate: string, n: number) => {
    const date = new Date(`${isoDate}T00:00:00`);
    date.setDate(date.getDate() + n);
    return toIso(date);
};

/** 日历月偏移；目标月份没有原日期时取该月最后一天（与 MySQL DATE_SUB 月语义对齐）。 */
export const addMonths = (isoDate: string, n: number) => {
    const [year, month, day] = isoDate.split("-").map(Number);
    const targetFirst = new Date(year, month - 1 + n, 1);
    const lastDay = new Date(targetFirst.getFullYear(), targetFirst.getMonth() + 1, 0).getDate();
    targetFirst.setDate(Math.min(day, lastDay));
    return toIso(targetFirst);
};

/** 当前时间 HH:mm（仅测试使用） */
export const nowTime = () => {
    const date = new Date();
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** 当前日期时间 MM-dd HH:mm（仅测试使用） */
export const nowStamp = () => `${todayIso().slice(5)} ${nowTime()}`;

/** 带时区的 ISO 日期时间转本地展示 yyyy-MM-dd HH:mm */
export const formatDateTime = (iso: string) => {
    const date = new Date(iso);
    return `${toIso(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** MM/DD 简写（交期筛选按钮回显用，保留前导零） */
export const shortDate = (isoDate: string) => `${isoDate.slice(5, 7)}/${isoDate.slice(8, 10)}`;

/** 当月第一天 yyyy-MM-01（默认区间、快捷月区间共用） */
export const monthStartOf = (isoDate: string) => `${isoDate.slice(0, 7)}-01`;
