// @vitest-environment jsdom
/* 工作台演示数据使用北京时间作为业务截至日，并稳定复用同日数据。 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkbenchData } from "@/pages/workbench/useWorkbenchData";
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});
it("UTC日期跨入北京时间次日时生成正确的截至日", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T18:00:00Z"));
    const { result, rerender } = renderHook(useWorkbenchData);
    expect(result.current.asOf).toBe("2026-09-12");
    const before = result.current;
    rerender();
    expect(result.current).toBe(before);
});
