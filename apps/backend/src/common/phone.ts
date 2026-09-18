/**
 * 客户手机号展示掩码（db-scheme.md §5：完整号码只存库，普通响应只返回掩码；
 * openapi pattern ^1[0-9]{2}\*{4}[0-9]{4}$，如 138****5678）。
 */
export function maskPhone(phone: string): string {
    return `${phone.slice(0, 3)}****${phone.slice(7)}`;
}
