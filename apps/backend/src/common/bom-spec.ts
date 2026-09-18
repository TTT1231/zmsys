import { createHash } from "node:crypto";

/**
 * BOM 物料集合判重（db-scheme.md §5 bom_table）：materialItemIds 先校验为
 * 正十进制 BIGINT 数字串，再规范化为 BigInt 十进制字符串（消除 "001"/"1" 的
 * 双表示——同一物料 id 只允许一种判重形式），去重后按数值升序序列化为 JSON
 * 字符串数组，SHA-256 → 32 字节 spec_hash。展示值与判重值分离，判重只用这一套。
 */

/** MySQL BIGINT 有符号上限（2^63-1）：id 为 Snowflake/种子正数，不允许越界 */
const BIGINT_MAX = 9223372036854775807n;

/** 数字串校验：非空、仅 0-9（前导零允许，规范化时消除） */
const DIGITS_PATTERN = /^[0-9]+$/;

/** 物料 id 规范化：非法或越界返回 null（错误消息由调用方按契约文案抛出） */
export function normalizeMaterialId(id: string): string | null {
    if (typeof id !== "string" || !DIGITS_PATTERN.test(id)) {
        return null;
    }
    const value = BigInt(id);
    if (value <= 0n || value > BIGINT_MAX) {
        return null;
    }
    return value.toString();
}

/** BigInt 数值升序比较（不得转 Number 排序：Snowflake id 超 Number.MAX_SAFE_INTEGER） */
const compareByValue = (a: string, b: string): number => {
    const left = BigInt(a);
    const right = BigInt(b);
    return left < right ? -1 : left > right ? 1 : 0;
};

/**
 * 集合规范化：去重 + 数值升序。入参必须已通过 normalizeMaterialId 逐个校验；
 * 未校验直接传入时非法值按 Error 快速失败（程序性缺陷不容静默跳过）。
 */
export function canonicalMaterialIds(ids: string[]): string[] {
    const normalized = ids.map(id => {
        const value = normalizeMaterialId(id);
        if (value === null) {
            throw new Error(`物料编号非法：${id}`);
        }
        return value;
    });
    return [...new Set(normalized)].sort(compareByValue);
}

/** spec_hash = SHA-256(规范化 id 数组的 JSON 字符串 UTF-8 字节)，32 字节（对应 BINARY(32)） */
export function materialSetHash(ids: string[]): Uint8Array<ArrayBuffer> {
    return new Uint8Array(
        createHash("sha256")
            .update(JSON.stringify(canonicalMaterialIds(ids)), "utf8")
            .digest(),
    );
}
