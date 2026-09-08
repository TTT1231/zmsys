/* ISO 日期（yyyy-MM-dd）工具：全部按本地时区计算 */
const pad = (value: number) => String(value).padStart(2, "0");

export const toIso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const todayIso = () => toIso(new Date());

export const addDays = (isoDate: string, n: number) => {
    const date = new Date(`${isoDate}T00:00:00`);
    date.setDate(date.getDate() + n);
    return toIso(date);
};

/** 当前时间 HH:mm（mock 台账/日志写入用） */
export const nowTime = () => {
    const date = new Date();
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** 当前日期时间 MM-dd HH:mm（最近登录等展示用） */
export const nowStamp = () => `${todayIso().slice(5)} ${nowTime()}`;
