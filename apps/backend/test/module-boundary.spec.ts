/**
 * 架构测试：业务模块之间禁止互相 import 内部文件（AGENTS.md 依赖方向约定）。
 * 共享层（common/access-control/idempotency/sequence/prisma 等）可被任何业务模块引用；
 * auth 与 roles 等业务模块互引会随 users 等模块加入演化为循环依赖。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 业务模块目录清单：新增业务模块时在此登记
const BUSINESS_MODULES = ['auth', 'roles', 'users'] as const;

const SRC_ROOT = join(__dirname, '..', 'src');

const listTsFiles = (dir: string): string[] => {
    const entries = readdirSync(dir);
    return entries.flatMap(entry => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            return listTsFiles(full);
        }
        return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [full] : [];
    });
};

describe('模块边界（业务模块互引检查）', () => {
    for (const moduleName of BUSINESS_MODULES) {
        it(`${moduleName} 不 import 其他业务模块的内部文件`, () => {
            const files = listTsFiles(join(SRC_ROOT, moduleName));
            expect(files.length, `${moduleName} 目录应存在`).toBeGreaterThan(0);
            for (const file of files) {
                const content = readFileSync(file, 'utf8');
                for (const other of BUSINESS_MODULES) {
                    if (other === moduleName) {
                        continue;
                    }
                    expect(
                        content.includes(`from '../${other}/`),
                        `${file} 引用了业务模块 ${other} 的内部文件，请改经共享层（common/access-control）`,
                    ).toBe(false);
                }
            }
        });
    }
});
