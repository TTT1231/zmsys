// 覆盖物料集合判重规范化：数字串校验、BigInt 十进制消除前导零、去重、数值升序、
// 数量参与判重与 SHA-256 指纹
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalMaterialEntries, materialSetHash, normalizeMaterialId, type MaterialSpecEntry } from "./bom-spec";

const entry = (id: string, quantity = 1): MaterialSpecEntry => ({ id, quantity });

describe("normalizeMaterialId（物料 id 规范化）", () => {
    it("前导零折叠为同一 BigInt 十进制形式（同一物料只有一种判重表示）", () => {
        expect(normalizeMaterialId("001")).toBe("1");
        expect(normalizeMaterialId("1")).toBe("1");
        expect(normalizeMaterialId("9007199254740993")).toBe("9007199254740993");
    });

    it("非法输入返回 null：空串、非数字、非字符串、0、负数、超出 BIGINT 范围", () => {
        expect(normalizeMaterialId("")).toBeNull();
        expect(normalizeMaterialId("12x")).toBeNull();
        expect(normalizeMaterialId("1.0")).toBeNull();
        expect(normalizeMaterialId(" 1")).toBeNull();
        expect(normalizeMaterialId(1 as unknown as string)).toBeNull();
        expect(normalizeMaterialId("0")).toBeNull();
        expect(normalizeMaterialId("-1")).toBeNull();
        expect(normalizeMaterialId("9223372036854775808")).toBeNull();
    });
});

describe("canonicalMaterialEntries（集合规范化）", () => {
    it("去重 + BigInt 数值升序（Snowflake 量级不转 Number）", () => {
        expect(canonicalMaterialEntries([entry("3003"), entry("3001"), entry("3003"), entry("3002")])).toEqual([
            entry("3001"),
            entry("3002"),
            entry("3003"),
        ]);
        expect(canonicalMaterialEntries([entry("9007199254740993"), entry("9999")])).toEqual([
            entry("9999"),
            entry("9007199254740993"),
        ]);
    });

    it("前导零输入与规范输入产出相同集合；同 id 重复条目保留首个数量", () => {
        expect(canonicalMaterialEntries([entry("03001"), entry("3002")])).toEqual([entry("3001"), entry("3002")]);
        expect(canonicalMaterialEntries([entry("3001", 2), entry("03001", 5)])).toEqual([entry("3001", 2)]);
    });

    it("未校验的非法 id 快速失败（程序性缺陷）", () => {
        expect(() => canonicalMaterialEntries([entry("3001"), entry("bad")])).toThrow("物料编号非法");
    });
});

describe("materialSetHash（SHA-256 指纹）", () => {
    it("同一集合不同输入顺序指纹一致（ID 顺序不影响判重）", () => {
        const a = materialSetHash([entry("3001"), entry("3002"), entry("3003")]);
        const b = materialSetHash([entry("3003"), entry("3001"), entry("3002")]);
        expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    });

    it("重复输入去重后指纹一致；前导零双表示指纹一致", () => {
        const base = materialSetHash([entry("3001")]);
        expect(Buffer.from(materialSetHash([entry("3001"), entry("3001")])).equals(Buffer.from(base))).toBe(true);
        expect(Buffer.from(materialSetHash([entry("03001")])).equals(Buffer.from(base))).toBe(true);
    });

    it("不同集合指纹不同（增删物料均变化）", () => {
        const base = materialSetHash([entry("3001"), entry("3002")]);
        expect(Buffer.from(materialSetHash([entry("3001"), entry("3003")])).equals(Buffer.from(base))).toBe(false);
        expect(Buffer.from(materialSetHash([entry("3001")])).equals(Buffer.from(base))).toBe(false);
    });

    it("同一物料集合不同数量指纹不同（数量参与判重）", () => {
        const base = materialSetHash([entry("3001"), entry("3002", 1)]);
        expect(Buffer.from(materialSetHash([entry("3001"), entry("3002", 2)])).equals(Buffer.from(base))).toBe(false);
        expect(Buffer.from(materialSetHash([entry("3001", 2), entry("3002", 2)])).equals(Buffer.from(base))).toBe(
            false,
        );
    });

    it("指纹与 [[id, quantity]] JSON 序列化直接对齐（迁移 SQL 同构校验）", () => {
        const expected = createHash("sha256").update('[["3001",1],["3002",3]]', "utf8").digest();
        expect(Buffer.from(materialSetHash([entry("3002", 3), entry("3001")])).equals(expected)).toBe(true);
    });

    it("指纹长度 32 字节（对应 BINARY(32) 列）", () => {
        expect(materialSetHash([entry("3001")]).length).toBe(32);
    });
});
