import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { ListViewContext, type ListSearchRegistration } from "./useListView";

export function ListViewProvider({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const [values] = useState(() => new Map<string, unknown>());
    const [search, setSearch] = useState<ListSearchRegistration | null>(null);
    const registerSearch = useCallback((next: ListSearchRegistration) => {
        setSearch(next);
        return () => setSearch(current => (current?.owner === next.owner ? null : current));
    }, []);
    const value = useMemo(
        () => ({ values, registerSearch, activeSearch: search?.pathname === pathname ? search : null }),
        [values, registerSearch, search, pathname],
    );
    return <ListViewContext.Provider value={value}>{children}</ListViewContext.Provider>;
}
