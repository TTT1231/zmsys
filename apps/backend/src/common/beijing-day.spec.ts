import { describe, expect, it } from 'vitest';
import { beijingDayKey, beijingDayWindow } from './beijing-day';

describe('beijingDayWindow（北京日窗口）', () => {
    it('北京 00:00 对应 UTC 前一日 16:00', () => {
        // UTC 2026-09-12T10:30 = 北京 18:30，当日窗口为北京 09-12 全天
        const window = beijingDayWindow(new Date('2026-09-12T10:30:00.000Z'));
        expect(window.start.toISOString()).toBe('2026-09-11T16:00:00.000Z');
        expect(window.nextStart.toISOString()).toBe('2026-09-12T16:00:00.000Z');
    });

    it('北京 23:59:59.999 与次日 00:00 分属两个窗口', () => {
        const lastMs = beijingDayWindow(new Date('2026-09-12T15:59:59.999Z')); // 北京 09-12 23:59:59.999
        const nextMs = beijingDayWindow(new Date('2026-09-12T16:00:00.000Z')); // 北京 09-13 00:00
        expect(lastMs.nextStart.getTime()).toBe(nextMs.start.getTime());
        expect(beijingDayKey(new Date('2026-09-12T15:59:59.999Z'))).toBe('2026-09-12');
        expect(beijingDayKey(new Date('2026-09-12T16:00:00.000Z'))).toBe('2026-09-13');
    });

    it('窗口宽度恒为 24 小时', () => {
        const window = beijingDayWindow(new Date('2026-01-01T00:00:00.000Z'));
        expect(window.nextStart.getTime() - window.start.getTime()).toBe(24 * 60 * 60 * 1000);
    });
});

describe('beijingDayKey（北京日期键）', () => {
    it('跨年边界：UTC 年末 16:30 已是北京新年', () => {
        expect(beijingDayKey(new Date('2026-12-31T16:30:00.000Z'))).toBe('2027-01-01');
    });
});
