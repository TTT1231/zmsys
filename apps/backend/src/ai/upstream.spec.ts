import { describe, expect, it } from "vitest";
import { normalizeUsage, sniffSseUsage } from "./upstream";

describe("AI 用量口径", () => {
    it.each([undefined, {}, { prompt_tokens: -1 }, { total_tokens: Infinity }, { completion_tokens: NaN }])(
        "没有有效字段时保留未知：%j",
        raw => expect(normalizeUsage(raw)).toBeNull(),
    );

    it("完整的真实零与未知不同", () => {
        expect(normalizeUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })).toEqual({
            status: "known",
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
        });
    });

    it("明细齐全时可推导总量", () => {
        expect(normalizeUsage({ prompt_tokens: 10, completion_tokens: 5 })).toEqual({
            status: "known",
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
        });
    });

    it.each([{ total_tokens: 15 }, { prompt_tokens: 10 }])("只取得部分字段时明确标记：%j", raw => {
        expect(normalizeUsage(raw)?.status).toBe("partial");
    });

    it("后续空 usage 帧不会覆盖已经取得的用量", () => {
        const captured: unknown[] = [];
        sniffSseUsage('data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\ndata: {"usage":{}}\n\n', usage =>
            captured.push(usage),
        );
        expect(captured).toEqual([{ status: "known", promptTokens: 10, completionTokens: 5, totalTokens: 15 }]);
    });
});
