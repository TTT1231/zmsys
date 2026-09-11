/**
 * 架构测试：自动发现 src 下所有 *.controller.ts，断言每个路由 handler
 * 恰好声明 @Public() / @AuthenticatedOnly() / @Permissions([...]) 之一。
 * 漏标或重复声明即失败（一次性报告全部违规项）——权限默认拒绝的 CI 期兜底。
 */
import 'reflect-metadata';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTH_ONLY_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../src/constants';

// Nest 路由装饰器（@Get/@Post/...）写入的 method 元数据键（Nest 稳定内部约定）
const METHOD_METADATA = '__method__';

const SRC_ROOT = join(__dirname, '..', 'src');

const findControllers = (dir: string): string[] => {
    const entries = readdirSync(dir);
    return entries.flatMap(entry => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            return findControllers(full);
        }
        return entry.endsWith('.controller.ts') ? [full] : [];
    });
};

describe('权限元数据三选一（默认拒绝的架构兜底）', () => {
    it('每个路由 handler 恰好声明 @Public/@AuthenticatedOnly/@Permissions 之一', async () => {
        const files = findControllers(SRC_ROOT);
        expect(files.length, '自动发现 controller（发现数应随业务模块增长）').toBeGreaterThanOrEqual(2);

        const violations: string[] = [];
        for (const file of files) {
            const moduleExports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
            for (const [exportName, exported] of Object.entries(moduleExports)) {
                if (typeof exported !== 'function' || !exported.prototype) {
                    continue;
                }
                const prototype = exported.prototype;
                for (const methodName of Object.getOwnPropertyNames(prototype)) {
                    if (methodName === 'constructor') {
                        continue;
                    }
                    // 仅检查路由方法（被 @Get/@Post 等装饰），非路由辅助方法不强制
                    if (Reflect.getMetadata(METHOD_METADATA, prototype, methodName) === undefined) {
                        continue;
                    }
                    const declared = [
                        Reflect.getMetadata(IS_PUBLIC_KEY, prototype, methodName),
                        Reflect.getMetadata(AUTH_ONLY_KEY, prototype, methodName),
                        Reflect.getMetadata(PERMISSIONS_KEY, prototype, methodName),
                    ].filter(value => value !== undefined);
                    if (declared.length !== 1) {
                        violations.push(
                            `${file} → ${exportName}.${methodName} 声明了 ${declared.length} 个访问策略（必须恰好 1 个）`,
                        );
                    }
                }
            }
        }
        expect(violations.join('\n')).toBe('');
    });
});
