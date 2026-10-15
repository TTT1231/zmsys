import type { QueryClient } from "@tanstack/react-query";
import { fetchAiQuery } from "@/api/ai-chat";

export const AI_QUERY_STALE_MS = 5 * 60_000;
export const aiQueryKey = (scope: string) => ["ai-tools", scope] as const;

export interface AiQueryResult {
    data: unknown;
    queriedAt: string;
    cached: boolean;
}

/** 缓存沿用页面的 QueryClient；账号、角色和授权版本都是缓存边界。 */
export async function queryAiData(
    client: QueryClient,
    scope: string,
    path: string,
    signal: AbortSignal,
    fresh = false,
): Promise<AiQueryResult> {
    signal.throwIfAborted();
    const [pathname, search = ""] = path.split("?");
    const params = new URLSearchParams(search);
    params.sort();
    const canonical = pathname + (params.size ? `?${params}` : "");
    const key = [...aiQueryKey(scope), canonical];
    if (fresh) await client.invalidateQueries({ queryKey: key, exact: true });
    const previous = client.getQueryState(key);
    const cached = Boolean(
        previous?.status === "success" &&
        !previous.isInvalidated &&
        Date.now() - previous.dataUpdatedAt < AI_QUERY_STALE_MS,
    );
    const result = await client.fetchQuery({
        queryKey: key,
        queryFn: async () => ({ data: await fetchAiQuery(canonical, signal), queriedAt: new Date().toISOString() }),
        staleTime: AI_QUERY_STALE_MS,
        gcTime: AI_QUERY_STALE_MS,
        retry: false,
    });
    signal.throwIfAborted();
    return { ...result, cached };
}
