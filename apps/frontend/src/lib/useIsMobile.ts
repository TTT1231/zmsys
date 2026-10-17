import { useCallback, useSyncExternalStore } from "react";

export function useMediaQuery(query: string, fallback = false) {
    const subscribe = useCallback(
        (listener: () => void) => {
            if (typeof window.matchMedia !== "function") return () => {};
            const media = window.matchMedia(query);
            media.addEventListener("change", listener);
            return () => media.removeEventListener("change", listener);
        },
        [query],
    );
    const getSnapshot = useCallback(
        () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback),
        [query, fallback],
    );
    return useSyncExternalStore(subscribe, getSnapshot, () => fallback);
}

/** 与 lg 断点一致，用于确实需要区分数据筛选语义的移动视图。 */
export function useIsMobile() {
    return !useMediaQuery("(min-width: 1024px)", true);
}
