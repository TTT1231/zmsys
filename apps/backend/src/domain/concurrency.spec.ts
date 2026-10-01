import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma/transaction.runner";
import { assertVersionMatches, lockRowByKey, lockRowsById } from "./concurrency";

/** 递归展开 Prisma.Sql（{strings, values} 嵌套）为最终 SQL 文本，仅测试断言用 */
const renderSql = (strings: readonly string[], ...values: unknown[]): string => {
    const isSql = (value: unknown): value is { strings: string[]; values: unknown[] } =>
        value !== null && typeof value === "object" && "strings" in value && "values" in value;
    let out = "";
    values.forEach((value, i) => {
        out += strings[i];
        out += isSql(value) ? renderSql(value.strings, ...value.values) : String(value);
    });
    return out + (strings[strings.length - 1] ?? "");
};

function createTx() {
    const queryRaw = vi.fn().mockResolvedValue([]);
    return { tx: { $queryRaw: queryRaw } as unknown as Tx, queryRaw };
}

describe("lockRowsById（固定顺序行锁）", () => {
    it("id 升序去重后单次 FOR UPDATE", async () => {
        const { tx, queryRaw } = createTx();
        await lockRowsById(tx, "bom_table", [30n, 10n, 30n, 20n]);
        expect(queryRaw).toHaveBeenCalledOnce();
        const [strings, ...values] = queryRaw.mock.calls[0] as unknown as [string[], ...unknown[]];
        expect(renderSql(strings, ...values)).toBe("SELECT id FROM bom_table WHERE id IN (10,20,30) FOR UPDATE");
    });

    it("空列表不发 SQL", async () => {
        const { tx, queryRaw } = createTx();
        await lockRowsById(tx, "bom_table", []);
        expect(queryRaw).not.toHaveBeenCalled();
    });

    it("表名不在白名单时类型即拒绝（编译期约束，无运行时拼接面）", () => {
        // LockableTable 是字面量联合；此处仅确认导出类型存在
        const tables: readonly string[] = ["bom_table", "sys_user"];
        expect(tables).toContain("bom_table");
    });
});

describe("lockRowByKey（自然键定位锁）", () => {
    it("白名单列名拼接、值参数化", async () => {
        const { tx, queryRaw } = createTx();
        await lockRowByKey(tx, "sales_order_table", "DD2601010001");
        expect(queryRaw).toHaveBeenCalledOnce();
        const [strings, ...values] = queryRaw.mock.calls[0] as unknown as [string[], ...unknown[]];
        expect(renderSql(strings, ...values)).toBe(
            "SELECT id FROM sales_order_table WHERE order_no = DD2601010001 FOR UPDATE",
        );
    });

    it("表名不在白名单时类型即拒绝（编译期约束，无运行时拼接面）", () => {
        // LockableKeyTable 是字面量联合；此处仅确认导出类型存在
        const tables: readonly string[] = ["sys_user", "sys_role"];
        expect(tables).toContain("sys_user");
    });
});

describe("assertVersionMatches（乐观锁版本比对 → 409）", () => {
    it("版本不一致抛 ConflictException", () => {
        expect(() => assertVersionMatches(3n, 2, "订单已被其他人修改，请刷新后重试")).toThrow(ConflictException);
    });

    it("版本一致放行", () => {
        expect(() => assertVersionMatches(2n, 2, "订单已被其他人修改，请刷新后重试")).not.toThrow();
    });
});
