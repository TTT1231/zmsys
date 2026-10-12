// 全局查询中间件的注入/豁免规则(纯函数,node 直跑):updatedAt 的注入与显式
// 尊重(upsert 仅 update 分支)
import { describe, expect, it } from "vitest";
import { applyUpdatedAt } from "./prisma-extensions";

describe("applyUpdatedAt(updatedAt 统一注入)", () => {
    it("update 未显式传值时注入当前时刻(Node 时钟)", () => {
        const args: { data: { remark: string; updatedAt?: unknown } } = { data: { remark: "x" } };
        applyUpdatedAt(args, "update");
        expect(args.data.updatedAt).toBeInstanceOf(Date);
    });

    it("显式传值(登录回写旧值压制刷新)原样尊重", () => {
        const pinned = new Date("2026-01-01T00:00:00Z");
        const args = { data: { lastLoginAt: new Date(), updatedAt: pinned } };
        applyUpdatedAt(args, "update");
        expect(args.data.updatedAt).toBe(pinned);
    });

    it("upsert 仅 update 分支注入,create 分支不动", () => {
        const args = { data: { create: { id: 1n }, update: { remark: "x" } } };
        applyUpdatedAt(args, "upsert");
        expect((args.data.update as { updatedAt?: unknown }).updatedAt).toBeInstanceOf(Date);
        expect((args.data.create as { updatedAt?: unknown }).updatedAt).toBeUndefined();
    });

    it("update 分支已显式传值的 upsert 不覆盖", () => {
        const pinned = new Date("2026-01-01T00:00:00Z");
        const args = { data: { create: { id: 1n }, update: { updatedAt: pinned } } };
        applyUpdatedAt(args, "upsert");
        expect((args.data.update as { updatedAt?: unknown }).updatedAt).toBe(pinned);
    });
});
