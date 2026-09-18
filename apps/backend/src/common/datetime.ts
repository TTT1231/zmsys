/** 北京时间展示戳 MM-dd HH:mm，与前端契约的展示值格式一致 */
const stampFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});

export function formatBeijingStamp(date: Date | null): string {
    return date ? stampFormatter.format(date).replace("/", "-") : "—";
}

/**
 * DATE 列（order_date / business_date 等）的契约格式 yyyy-MM-dd（openapi format: date）。
 * Prisma 经 UTC 会话把 DATE 读为 UTC 午夜 Date（进程时区也统一 UTC），直接按 UTC 拆解；
 * 不经此转换直接返回 Date 会输出完整 ISO 时间，不符合契约。
 */
export function formatDateColumn(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/** 契约 yyyy-MM-dd（已过 DTO 校验）→ UTC 午夜 Date，@db.Date 列的写入形态 */
export function toDateColumn(date: string): Date {
    return new Date(`${date}T00:00:00.000Z`);
}
