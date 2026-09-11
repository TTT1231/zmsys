import { describe, expect, it } from 'vitest';
import { SnowflakeGenerator } from './snowflake';

describe('SnowflakeGenerator（业务主键）', () => {
    it('连续生成严格单调递增', () => {
        const gen = new SnowflakeGenerator(1n);
        let prev = gen.next();
        for (let i = 0; i < 1000; i++) {
            const id = gen.next();
            expect(id).toBeGreaterThan(prev);
            prev = id;
        }
    });

    it('批量生成无重复', () => {
        const gen = new SnowflakeGenerator(1n);
        const ids = new Set<bigint>();
        for (let i = 0; i < 5000; i++) {
            ids.add(gen.next());
        }
        expect(ids.size).toBe(5000);
    });

    it('生成的 id 始终大于 1–9999 的保留区间', () => {
        const gen = new SnowflakeGenerator(1n);
        expect(gen.next()).toBeGreaterThan(9999n);
    });

    it('workerId 越界（>1023）拒绝构造', () => {
        expect(() => new SnowflakeGenerator(1024n)).toThrow();
        expect(() => new SnowflakeGenerator(-1n)).toThrow();
    });
});
