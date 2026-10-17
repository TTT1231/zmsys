import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from "react";
import { useLocation } from "react-router";

export interface ListSearchRegistration {
    owner: symbol;
    pathname: string;
    title: string;
    keyword: string;
    placeholder: string;
    submit: (value: string) => void;
}

interface ListViewContextValue {
    values: Map<string, unknown>;
    activeSearch: ListSearchRegistration | null;
    registerSearch: (search: ListSearchRegistration) => () => void;
}

export const ListViewContext = createContext<ListViewContextValue | null>(null);

const PAGE_TITLES: Record<string, string> = {
    "/orders": "销售订单",
    "/archived-orders": "归档订单",
    "/customers": "客户档案",
    "/bom": "物料与 BOM",
    "/inbound": "成品入库",
    "/outbound": "成品出库",
    "/stock": "库存",
    "/system-logs": "系统日志",
};

/** 条件只在当前登录会话中按页面记忆；无外壳的独立页面仍可正常使用。 */
export function useRememberedListState<T>(name: string, initial: T | (() => T), preferInitial = false) {
    const values = useContext(ListViewContext)?.values;
    const { pathname } = useLocation();
    const key = `${pathname}:${name}`;
    const [value, setValue] = useState<T>(() =>
        !preferInitial && values?.has(key)
            ? (values.get(key) as T)
            : typeof initial === "function"
              ? (initial as () => T)()
              : initial,
    );
    useEffect(() => {
        values?.set(key, value);
    }, [key, value, values]);
    const setRememberedValue: Dispatch<SetStateAction<T>> = useCallback(
        next => {
            setValue(current => {
                const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
                values?.set(key, resolved);
                return resolved;
            });
        },
        [key, values],
    );
    return [value, setRememberedValue] as const;
}

export function useRegisterListSearch(keyword: string, submit: (value: string) => void, placeholder: string) {
    const register = useContext(ListViewContext)?.registerSearch;
    const { pathname } = useLocation();
    const [owner] = useState(() => Symbol("list-search"));
    const submitRef = useRef(submit);
    useEffect(() => {
        submitRef.current = submit;
    });
    useEffect(() => {
        const title = PAGE_TITLES[pathname];
        if (!register || !title) return;
        return register({ owner, pathname, title, keyword, placeholder, submit: value => submitRef.current(value) });
    }, [register, owner, pathname, keyword, placeholder]);
}

export function useListSearch() {
    return useContext(ListViewContext)?.activeSearch ?? null;
}
