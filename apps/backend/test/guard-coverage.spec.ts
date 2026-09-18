/**
 * 架构测试：自动发现 src 下所有 *.controller.ts，断言每个路由 handler
 * 恰好声明 @Public() / @AuthenticatedOnly() / @Permissions([...]) 之一。
 * 漏标或重复声明即失败（一次性报告全部违规项）——权限默认拒绝的 CI 期兜底。
 */
import "reflect-metadata";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { AUTH_ONLY_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY } from "../src/constants";

// Nest 路由装饰器（@Get/@Post/...）把 method 元数据写在 handler 函数自身上（Nest 稳定内部约定，
// @nestjs/common constants：'method'；SetMetadata 类装饰器同样写函数而非 prototype 属性）
const METHOD_METADATA = "method";

const SRC_ROOT = join(__dirname, "..", "src");

const findControllers = (dir: string): string[] => {
    const entries = readdirSync(dir);
    return entries.flatMap(entry => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            return findControllers(full);
        }
        return entry.endsWith(".controller.ts") ? [full] : [];
    });
};

describe("权限元数据三选一（默认拒绝的架构兜底）", () => {
    // 逐文件动态 import 会拉起全部模块依赖链，冷启动远超默认 5s，显式放宽
    it("每个路由 handler 恰好声明 @Public/@AuthenticatedOnly/@Permissions 之一", { timeout: 30_000 }, async () => {
        const files = findControllers(SRC_ROOT);
        expect(files.length, "自动发现 controller（发现数应随业务模块增长）").toBeGreaterThanOrEqual(2);

        const violations: string[] = [];
        let checkedHandlers = 0;
        for (const file of files) {
            const moduleExports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
            for (const [exportName, exported] of Object.entries(moduleExports)) {
                if (typeof exported !== "function" || !exported.prototype) {
                    continue;
                }
                const prototype = exported.prototype;
                for (const methodName of Object.getOwnPropertyNames(prototype)) {
                    if (methodName === "constructor") {
                        continue;
                    }
                    const handler = prototype[methodName];
                    if (typeof handler !== "function") {
                        continue;
                    }
                    // 仅检查路由方法（被 @Get/@Post 等装饰），非路由辅助方法不强制
                    if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) {
                        continue;
                    }
                    checkedHandlers += 1;
                    const declared = [
                        Reflect.getMetadata(IS_PUBLIC_KEY, handler),
                        Reflect.getMetadata(AUTH_ONLY_KEY, handler),
                        Reflect.getMetadata(PERMISSIONS_KEY, handler),
                    ].filter(value => value !== undefined);
                    if (declared.length !== 1) {
                        violations.push(
                            `${file} → ${exportName}.${methodName} 声明了 ${declared.length} 个访问策略（必须恰好 1 个）`,
                        );
                    }
                }
            }
        }
        expect(violations.join("\n")).toBe("");
        // 防空转兜底：元数据键或挂载位置漂移会让上方循环静默跳过全部 handler，0 检出也绿
        expect(checkedHandlers, "至少检出既有 11 条路由（auth 5 / roles 4 / health 2）").toBeGreaterThanOrEqual(11);
    });
});
