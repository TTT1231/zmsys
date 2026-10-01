// 全局查询中间件的注入/豁免规则(纯函数,node 直跑):软删过滤的注入、显式豁免、
// 无 where 补建;updatedAt 的注入与显式尊重(upsert 仅 update 分支)
import { describe, expect, it } from "vitest";
import { applySoftDeleteFilter, applyUpdatedAt } from "./prisma-extensions";

describe("applySoftDeleteFilter(软删注入)", () => {
    it("未声明 deletedAt 的 where 注入过滤", () => {
        const args = { where: { orderNo: "ZM2609120001" } };
        applySoftDeleteFilter(args);
        expect(args.where).toEqual({ orderNo: "ZM2609120001", deletedAt: null });
    });

    it("无 where 的全表操作补建过滤(漏写即防复活)", () => {
        const args: { where?: unknown } = {};
        applySoftDeleteFilter(args);
        expect(args.where).toEqual({ deletedAt: null });
    });

    it("显式 deletedAt 条件(任意形态)即豁免:物理清理的反向条件原样尊重", () => {
        const args = { where: { id: { in: [1n] }, deletedAt: { not: null } } };
        applySoftDeleteFilter(args);
        expect(args.where).toEqual({ id: { in: [1n] }, deletedAt: { not: null } });
    });

    it("undefined 值字段不构成豁免：Prisma 到达扩展前已剥离 undefined，键不存在仍注入", () => {
        // 与真实链路一致：模拟剥离后的 where（键不存在），过滤照常注入；
        // 须看到已删行的路径（FK 口径校验）应改走 $queryRaw
        const args: { where?: unknown } = { where: { bomId: 10n } };
        applySoftDeleteFilter(args);
        expect(args.where).toEqual({ bomId: 10n, deletedAt: null });
    });
});

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
