/** 北京时间展示戳 MM-dd HH:mm，与前端契约的展示值格式一致 */
const stampFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
});

export function formatBeijingStamp(date: Date | null): string {
    return date ? stampFormatter.format(date).replace('/', '-') : '—';
}
