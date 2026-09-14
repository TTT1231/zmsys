/* ISO 日期（yyyy-MM-dd）工具：全部按本地时区计算 */
const pad = (value: number) => String(value).padStart(2, "0");

export const toIso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const todayIso = () => toIso(new Date());

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

/** 当前时间 HH:mm（mock 台账/日志写入用） */
export const nowTime = () => {
    const date = new Date();
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** 当前日期时间 MM-dd HH:mm（最近登录等展示用） */
export const nowStamp = () => `${todayIso().slice(5)} ${nowTime()}`;

/** 带时区的 ISO 日期时间转本地展示 yyyy-MM-dd HH:mm */
export const formatDateTime = (iso: string) => {
    const date = new Date(iso);
    return `${toIso(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
