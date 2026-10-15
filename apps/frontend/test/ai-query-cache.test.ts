import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAiQuery } from "@/api/ai-chat";
import { AI_QUERY_STALE_MS, aiQueryKey, queryAiData } from "@/components/ai/query-cache";

vi.mock("@/api/ai-chat", () => ({ fetchAiQuery: vi.fn() }));
let client: QueryClient;
const signal = () => new AbortController().signal;
beforeEach(() => {
    client = new QueryClient();
    vi.mocked(fetchAiQuery)
        .mockReset()
        .mockResolvedValue([{ no: "RK1", qty: 5 }]);
    vi.useFakeTimers();
});
afterEach(() => {
    client.clear();
    vi.useRealTimers();
});

describe("AI 五分钟查询复用", () => {
    it("相同账号和请求复用结果，保留实际取数时间", async () => {
        const first = await queryAiData(client, "a:staff:1", "/inbound?b=2&a=1", signal());
        vi.advanceTimersByTime(60_000);
        const second = await queryAiData(client, "a:staff:1", "/inbound?a=1&b=2", signal());
        expect(fetchAiQuery).toHaveBeenCalledTimes(1);
        expect(first.cached).toBe(false);
        expect(second.cached).toBe(true);
        expect(second.queriedAt).toBe(first.queriedAt);
    });
    it("不同账号、授权版本或查询参数不会串用", async () => {
        await queryAiData(client, "a:staff:1", "/orders", signal());
        await queryAiData(client, "b:staff:1", "/orders", signal());
        await queryAiData(client, "a:staff:2", "/orders", signal());
        await queryAiData(client, "a:staff:1", "/orders?q=1", signal());
        expect(fetchAiQuery).toHaveBeenCalledTimes(4);
    });
    it("满五分钟、主动要求最新或写入后失效会重新取数", async () => {
        await queryAiData(client, "a", "/inbound", signal());
        vi.advanceTimersByTime(AI_QUERY_STALE_MS);
        await queryAiData(client, "a", "/inbound", signal());
        await queryAiData(client, "a", "/inbound", signal(), true);
        await client.invalidateQueries({ queryKey: aiQueryKey("a") });
        await queryAiData(client, "a", "/inbound", signal());
        expect(fetchAiQuery).toHaveBeenCalledTimes(4);
    });
    it("失败结果不复用，停止后的请求不再发送", async () => {
        vi.mocked(fetchAiQuery).mockRejectedValueOnce(new Error("网络不可用"));
        await expect(queryAiData(client, "a", "/inbound", signal())).rejects.toThrow("网络不可用");
        await queryAiData(client, "a", "/inbound", signal());
        await expect(queryAiData(client, "a", "/orders", AbortSignal.abort())).rejects.toBeDefined();
        expect(fetchAiQuery).toHaveBeenCalledTimes(2);
    });
});
