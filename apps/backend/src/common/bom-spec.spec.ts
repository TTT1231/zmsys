import { describe, expect, it } from 'vitest';
import { canonicalSpec, canonicalSpecJson, normalizeModelCode, specHash } from './bom-spec';

describe('normalizeModelCode（型号判重形式）', () => {
    it('NFKC + trim + 仅 ASCII 字母大写', () => {
        expect(normalizeModelCode('  abc-123 ')).toBe('ABC-123');
        expect(normalizeModelCode('ａｂｃ')).toBe('ABC'); // 全角经 NFKC 折叠为半角再大写
    });

    it('非 ASCII 字母不做大小写折叠', () => {
        // ā（U+0101）不是 ASCII 字母，保留原形
        expect(normalizeModelCode('ābc')).toBe('āBC');
    });
});

describe('canonicalSpec（规格规范化）', () => {
    it('键值 NFKC + trim，键码点升序与书写顺序无关', () => {
        expect(canonicalSpec({ 档位: ' 两档 ', 脚位: '三脚' })).toEqual({ 档位: '两档', 脚位: '三脚' });
        expect(canonicalSpec({ b: '2', a: '1' })).toEqual({ a: '1', b: '2' });
    });

    it('规范 JSON 无空白且键序稳定（同一规格恒同一哈希输入）', () => {
        const a = canonicalSpecJson({ 规格: '222-1', 脚位: '三脚' });
        const b = canonicalSpecJson({ 脚位: '三脚', 规格: '222-1' });
        expect(a).toBe(b);
        expect(a).not.toMatch(/\s/);
    });
});

describe('specHash（SHA-256 指纹）', () => {
    it('输出 32 字节且对键序不敏感', () => {
        const a = specHash({ 脚位: '三脚', 档位: '两档' });
        const b = specHash({ 档位: '两档', 脚位: '三脚' });
        expect(a).toHaveLength(32);
        expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    });

    it('值或键不同指纹即不同', () => {
        const base = specHash({ 脚位: '三脚' });
        expect(Buffer.from(specHash({ 脚位: '四脚' })).equals(Buffer.from(base))).toBe(false);
        expect(Buffer.from(specHash({ 档位: '三脚' })).equals(Buffer.from(base))).toBe(false);
    });
});
