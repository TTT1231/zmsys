import { createHash } from 'node:crypto';

/**
 * BOM 判重规范化（db-scheme.md §5 bom_table）：型号、规格键和值先做
 * Unicode NFKC 与 trim；型号中的 ASCII 字母按大写参与判重；规格键按
 * Unicode 码点升序生成 UTF-8 无空白规范 JSON，再计算 SHA-256 spec_hash。
 * 显示值可保留原大小写，判重只能用这一套规范化算法。
 */

/** 仅 ASCII 字母大写（不动全角/带符号字母，避免 NFKC 后的非 ASCII 大小写折叠） */
const upperAscii = (text: string): string => text.replace(/[a-z]/g, ch => ch.toUpperCase());

/** 型号判重形式：NFKC + trim + ASCII 大写 */
export function normalizeModelCode(modelCode: string): string {
    return upperAscii(modelCode.normalize('NFKC').trim());
}

/** Unicode 码点升序比较（默认字符串比较是 UTF-16 码元序，补充平面字符会排错） */
const compareByCodePoint = (a: string, b: string): number => {
    const left = [...a];
    const right = [...b];
    for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
        const diff = (left[i]!.codePointAt(0)! ?? 0) - (right[i]!.codePointAt(0)! ?? 0);
        if (diff !== 0) {
            return diff;
        }
    }
    return left.length - right.length;
};

/** 规格规范化：键值 NFKC + trim，键按码点升序；值保留原大小写 */
export function canonicalSpec(spec: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(spec)
            .map(([key, value]) => [key.normalize('NFKC').trim(), value.normalize('NFKC').trim()] as const)
            .sort(([a], [b]) => compareByCodePoint(a, b)),
    );
}

/** 规范 JSON：键已排序的 stringify（默认分隔符即无空白） */
export function canonicalSpecJson(spec: Record<string, string>): string {
    return JSON.stringify(canonicalSpec(spec));
}

/** spec_hash = SHA-256(规范 JSON 的 UTF-8 字节)，32 字节（对应 BINARY(32)） */
export function specHash(spec: Record<string, string>): Uint8Array<ArrayBuffer> {
    return new Uint8Array(createHash('sha256').update(canonicalSpecJson(spec), 'utf8').digest());
}
