import { todayIso as today } from "./date";

export const num = (value: number) => value.toLocaleString("zh-CN");

export const todayIso = today;

export function csvEscape(value: string) {
    if (/^[=+\-@]/.test(value)) return `'${value}`;
    return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function downloadCsv(filename: string, headers: string[], rows: string[][]) {
    const content = [
        `\uFEFF${headers.map(csvEscape).join(",")}`,
        ...rows.map(row => row.map(csvEscape).join(",")),
    ].join("\n");
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}-${todayIso()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}
