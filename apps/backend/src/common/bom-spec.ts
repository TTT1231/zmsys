import { createHash } from "node:crypto";

/** 判重指纹维度：品类 + 物料构成 + 备注（db-scheme.md §5 bom_table）。
 * 输入为「物料 id + 数量」对，id 先校验为正十进制 BIGINT 数字串，再规范化为
 * BigInt 十进制字符串（消除 "001"/"1" 的双表示——同一物料 id 只允许一种判重
 * 形式），数量为 1-99 整数（qty 分组步进器范围，非 qty 分组恒 1）。去重后按
 * id 数值升序序列化为 [[id, quantity], ...] 的 JSON 数组（数字不加引号），
 * 再与品类 id、备注组成三元素 JSON 数组，SHA-256 → 32 字节 spec_hash。
 * 同一物料集合、不同数量或不同备注 = 不同 BOM。展示值与判重值分离，判重只用这一套。 */

/** MySQL BIGINT 有符号上限（2^63-1）：id 为 Snowflake/种子正数，不允许越界 */
const BIGINT_MAX = 9223372036854775807n;

/** 数字串校验：非空、仅 0-9（前导零允许，规范化时消除） */
const DIGITS_PATTERN = /^[0-9]+$/;

/** qty 分组数量上限（步进器 1-99，与 bom_item.ck_bom_item_quantity 同口径） */
export const BOM_ITEM_QTY_MAX = 99;

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

/** 判重输入条目：id 十进制字符串 + 数量（1-99） */
export interface MaterialSpecEntry {
    id: string;
    quantity: number;
}

/** BigInt 数值升序比较（不得转 Number 排序：Snowflake id 超 Number.MAX_SAFE_INTEGER） */
const compareByValue = (a: string, b: string): number => {
    const left = BigInt(a);
    const right = BigInt(b);
    return left < right ? -1 : left > right ? 1 : 0;
};

/**
 * 集合规范化：去重（同 id 保留首个条目）+ id 数值升序。入参 id 必须已通过
 * normalizeMaterialId 逐个校验；未校验直接传入时非法值按 Error 快速失败
 * （程序性缺陷不容静默跳过）。数量范围由 resolveMaterialSelection 在业务侧校验。
 */
export function canonicalMaterialEntries(entries: MaterialSpecEntry[]): MaterialSpecEntry[] {
    const byId = new Map<string, MaterialSpecEntry>();
    for (const entry of entries) {
        const value = normalizeMaterialId(entry.id);
        if (value === null) {
            throw new Error(`物料编号非法：${entry.id}`);
        }
        if (!byId.has(value)) {
            byId.set(value, { id: value, quantity: entry.quantity });
        }
    }
    return [...byId.values()].sort((a, b) => compareByValue(a.id, b.id));
}

/**
 * spec_hash = SHA-256(JSON.stringify([categoryId, [[id, quantity], ...], remark])
 * 的 UTF-8 字节)，32 字节（对应 BINARY(32)）。categoryId 与物料 id 同规范
 * （BigInt 十进制字符串）；remark 为 trim 后原文（空串 = 无备注）。迁移
 * 20260922030000 引入数量维度、20260927000000 引入品类+备注维度，两次均以
 * 同构 SQL 重算全部存量。
 */
export function materialSetHash(
    categoryId: string | bigint,
    entries: MaterialSpecEntry[],
    remark: string,
): Uint8Array<ArrayBuffer> {
    const categoryKey = typeof categoryId === "string" ? normalizeMaterialId(categoryId) : categoryId.toString();
    if (categoryKey === null) {
        throw new Error(`品类编号非法：${categoryId}`);
    }
    return new Uint8Array(
        createHash("sha256")
            .update(
                JSON.stringify([
                    categoryKey,
                    canonicalMaterialEntries(entries).map(({ id, quantity }) => [id, quantity]),
                    remark,
                ]),
                "utf8",
            )
            .digest(),
    );
}
