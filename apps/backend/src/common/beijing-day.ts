/**
 * 北京自然日工具（db-scheme.md §2/§7）：北京固定 UTC+8 无夏令时，
 * 「入库当天修改窗口」与业务单号的日序号重置都以北京日窗口判定。
 */

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BeijingDayWindow {
    /** 北京当日 00:00（UTC 时刻），窗口起点（含） */
    start: Date;
    /** 北京次日 00:00（UTC 时刻），窗口终点（不含） */
    nextStart: Date;
}

/** 北京日窗口 [start, nextStart)：instant 所在北京自然日的零点到次日零点 */
export function beijingDayWindow(instant: Date = new Date()): BeijingDayWindow {
    // 平移到北京墙钟后按日取整，再平移回 UTC；不做日历库换算（北京无夏令时）
    const beijingDayStartMs = Math.floor((instant.getTime() + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS;
    const utcDayStartMs = beijingDayStartMs - BEIJING_OFFSET_MS;
    return { start: new Date(utcDayStartMs), nextStart: new Date(utcDayStartMs + DAY_MS) };
}

/** 北京日期键 yyyy-MM-dd（与 DATE 列的契约格式一致，用于窗口比对与展示） */
export function beijingDayKey(instant: Date = new Date()): string {
    return new Date(instant.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}
