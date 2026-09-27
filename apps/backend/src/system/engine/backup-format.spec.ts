import { describe, expect, it } from "vitest";
import {
    columnFamily,
    encodeMetaLine,
    encodeSqlString,
    parseInsertLine,
    parseMetaLine,
    serializeColumnValue,
    valueMatchesColumn,
    type BackupMeta,
    type ParsedValue,
} from "./backup-format";

/** 编码 → tokenizer 解码的往返（反斜杠/引号/换行/NUL/中文/JSON 原文） */
const roundtripString = (value: string): string => {
    const line = `INSERT INTO \`t\` (\`v\`) VALUES (${encodeSqlString(value)});`;
    const parsed = parseInsertLine(line);
    const cell = parsed.rows[0]?.[0];
    if (!cell || cell.kind !== "string") {
        throw new Error(`roundtrip 失败：${JSON.stringify(cell)}`);
    }
    return cell.text;
};

describe("SQL 字符串转义往返", () => {
    it("反斜杠/单引号/双引号", () => {
        expect(roundtripString(`a\\b'c"d`)).toBe(`a\\b'c"d`);
    });
    it("换行/回车/NUL/0x1a/制表符", () => {
        expect(roundtripString("line1\nline2\r\tend\u0000\u001a")).toBe("line1\nline2\r\tend\u0000\u001a");
    });
    it("中文与 emoji（UTF-8 保真）", () => {
        expect(roundtripString("中文测试💚跌倒开关")).toBe("中文测试💚跌倒开关");
    });
    it("JSON 原文不经解析（大整数保真）", () => {
        const json = '{"id":9007199254740993,"nested":{"a":null}}';
        expect(roundtripString(json)).toBe(json);
    });
    it("空串与全转义串", () => {
        expect(roundtripString("")).toBe("");
        expect(roundtripString("'\\'\n")).toBe("'\\'\n");
    });
});

describe("parseInsertLine 文法", () => {
    it("多行值 + 混合类型（NULL/负整数/十进制/十六进制/字符串）", () => {
        const parsed = parseInsertLine(
            "INSERT INTO `t` (`a`, `b`, `c`, `d`) VALUES (1, NULL, X'0A0B', 'x'), (-42, -3.5, X'00', '它\\'s');",
        );
        expect(parsed.table).toBe("t");
        expect(parsed.columns).toEqual(["a", "b", "c", "d"]);
        expect(parsed.rows).toEqual([
            [
                { kind: "int", text: "1" },
                { kind: "null" },
                { kind: "bytes", hex: "0A0B" },
                { kind: "string", text: "x" },
            ],
            [
                { kind: "int", text: "-42" },
                { kind: "decimal", text: "-3.5" },
                { kind: "bytes", hex: "00" },
                { kind: "string", text: "它's" },
            ],
        ] satisfies ParsedValue[][]);
    });

    it("拒绝：语句头不符合固定文法", () => {
        expect(() => parseInsertLine("INSERT INTO t (a) VALUES (1);")).toThrow();
        expect(() => parseInsertLine("INSERT INTO `t` (a) VALUES (1);")).toThrow();
        expect(() => parseInsertLine("REPLACE INTO `t` (`a`) VALUES (1);")).toThrow();
    });
    it("拒绝：字符串未闭合 / 非法转义上下文", () => {
        expect(() => parseInsertLine("INSERT INTO `t` (`a`) VALUES ('abc);")).toThrow();
        expect(() => parseInsertLine("INSERT INTO `t` (`a`) VALUES ('a\\');")).toThrow();
    });
    it("拒绝：无法识别的值 / 数字字面量非法 / 结束后残余", () => {
        expect(() => parseInsertLine("INSERT INTO `t` (`a`) VALUES (abc);")).toThrow();
        expect(() => parseInsertLine("INSERT INTO `t` (`a`) VALUES (1.2.3);")).toThrow();
        expect(() => parseInsertLine("INSERT INTO `t` (`a`) VALUES (1) (2);")).toThrow();
        expect(() => parseInsertLine("INSERT INTO `t` (`a`) VALUES (1); -- tail")).toThrow();
    });
    it("拒绝：值数与列数不符 / 重复列", () => {
        expect(() => parseInsertLine("INSERT INTO `t` (`a`, `b`) VALUES (1);")).toThrow();
        expect(() => parseInsertLine("INSERT INTO `t` (`a`, `a`) VALUES (1, 2);")).toThrow();
    });
    it("拒绝：十六进制奇数长度 / 非十六进制字符", () => {
        expect(() => parseInsertLine("INSERT INTO `t` (`a`) VALUES (X'ABC');")).toThrow();
        expect(() => parseInsertLine("INSERT INTO `t` (`a`) VALUES (X'ZZ');")).toThrow();
    });
});

describe("值序列化（写侧）", () => {
    it("bigint 保持十进制、decimal 保持文本、Buffer 十六进制、NULL", () => {
        expect(serializeColumnValue("integer", 9007199254740993n)).toBe("9007199254740993");
        expect(serializeColumnValue("decimal", "12345.678")).toBe("12345.678");
        expect(serializeColumnValue("binary", Buffer.from([0x0a, 0xff]))).toBe("X'0aff'");
        expect(serializeColumnValue("json", null)).toBe("NULL");
        expect(serializeColumnValue("datetime", "2026-09-24 10:08:32.123")).toBe("'2026-09-24 10:08:32.123'");
    });
    it("类型不符立即报错（不静默转换）", () => {
        // TINYINT/INT 等小整数由驱动返回 number（安全整数内精确）
        expect(serializeColumnValue("integer", 42)).toBe("42");
        expect(() => serializeColumnValue("integer", "42")).toThrow();
        expect(() => serializeColumnValue("integer", 1.5)).toThrow();
        expect(() => serializeColumnValue("json", {} as never)).toThrow();
    });
});

describe("列类型族与值匹配", () => {
    it("columnFamily 映射", () => {
        expect(columnFamily("bigint")).toBe("integer");
        expect(columnFamily("decimal")).toBe("decimal");
        expect(columnFamily("json")).toBe("json");
        expect(columnFamily("binary")).toBe("binary");
        expect(columnFamily("datetime")).toBe("datetime");
        expect(columnFamily("date")).toBe("date");
        expect(columnFamily("enum")).toBe("string");
        expect(() => columnFamily("float")).toThrow();
    });
    it("整数列拒绝 decimal/字符串/NULL(非空)", () => {
        expect(valueMatchesColumn({ kind: "int", text: "1" }, "integer", false)).toBe(true);
        expect(() => valueMatchesColumn({ kind: "decimal", text: "1.5" }, "integer", false)).toThrow();
        expect(() => valueMatchesColumn({ kind: "string", text: "1" }, "integer", false)).toThrow();
        expect(() => valueMatchesColumn({ kind: "null" }, "integer", false)).toThrow();
        expect(valueMatchesColumn({ kind: "null" }, "integer", true)).toBe(true);
    });
    it("datetime/date 格式校验", () => {
        expect(valueMatchesColumn({ kind: "string", text: "2026-09-24 10:08:32.123" }, "datetime", true)).toBe(true);
        expect(valueMatchesColumn({ kind: "string", text: "2026-09-24 10:08:32" }, "datetime", true)).toBe(true);
        expect(() => valueMatchesColumn({ kind: "string", text: "2026/09/24" }, "datetime", true)).toThrow();
        expect(valueMatchesColumn({ kind: "string", text: "2026-09-24" }, "date", true)).toBe(true);
        expect(() => valueMatchesColumn({ kind: "string", text: "2026-09-24 10:08:32" }, "date", true)).toThrow();
    });
    it("二进制列只接受十六进制字面量", () => {
        expect(valueMatchesColumn({ kind: "bytes", hex: "0AFF" }, "binary", false)).toBe(true);
        expect(() => valueMatchesColumn({ kind: "string", text: "0AFF" }, "binary", false)).toThrow();
    });
});

describe("meta 编解码", () => {
    const meta: BackupMeta = {
        format: "zmsys-backup",
        version: 1,
        createdAt: "2026-09-27T00:00:00.000Z",
        groups: ["users"],
        serverProduct: "MySQL",
        serverVersion: "8.0.46",
        latestMigration: "m1",
        schemaFingerprint: "abc",
        tables: [{ name: "sys_role", rowCount: 3 }],
    };
    it("encode → parse 往返", () => {
        const line = encodeMetaLine(meta);
        expect(line.startsWith("-- meta: ")).toBe(true);
        expect(line).not.toContain("\n");
        expect(parseMetaLine(line)).toEqual(meta);
    });
    it("拒绝：版本不受支持 / 字段缺失 / rowCount 非法", () => {
        expect(() => parseMetaLine('-- meta: {"format":"other","version":1}')).toThrow();
        const bad = { ...meta, tables: [{ name: "x", rowCount: -1 }] };
        expect(() => parseMetaLine(encodeMetaLine(bad as never))).toThrow();
        const missing = { ...meta, latestMigration: undefined } as unknown as BackupMeta;
        expect(() => parseMetaLine(encodeMetaLine(missing))).toThrow();
    });
});
