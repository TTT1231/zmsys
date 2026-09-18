import { ValidateBy } from "class-validator";

/**
 * 契约 DATE 列校验（openapi format: date）：yyyy-MM-dd 且为真实日历日
 * （拒绝 2026-02-30 这类正则可过、日历不存在的值）。
 */
export function isDateColumn(value: unknown): boolean {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const utcMidnight = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(utcMidnight.getTime()) && utcMidnight.toISOString().slice(0, 10) === value;
}

/** @IsDateColumn('下单日期') → “下单日期须为 yyyy-MM-dd 格式的真实日历日” */
export function IsDateColumn(label: string): PropertyDecorator {
    return ValidateBy({
        name: "isDateColumn",
        validator: {
            validate: (value): boolean => isDateColumn(value),
            defaultMessage: (): string => `${label}须为 yyyy-MM-dd 格式的真实日历日`,
        },
    });
}
