import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

/** 列表页控件状态机：关键字 / 分页 / 滚动区回顶 / 深链弹窗（各列表页共用）。
 *  筛选值（品类/状态/人员/日期段）各页语义不同，仍由页面自持，变更后回第 1 页
 *  的联动由页面在自己的 onChange 里调用返回的 setPage(1)。 */
export function useTableControls(
    opts: {
        /** 深链 ?new=<param> 首帧直开弹窗并自动清参数；不传不启用 */
        deepLinkNew?: string;
        /** 关键字初值（订单页 ?q= 深链预填） */
        initialKeyword?: string;
        /** 翻页/排序后滚动区回顶；订单页拖拽要跳过一次回顶，传 false 后自行管理 */
        scrollReset?: boolean;
        /** 追加的回顶依赖（如排序状态对象），变化后同样回到顶部 */
        resetKey?: unknown;
    } = {},
) {
    const { deepLinkNew, initialKeyword = "", scrollReset = true, resetKey } = opts;
    const [searchParams, setSearchParams] = useSearchParams();
    const [keyword, setKeyword] = useState(initialKeyword);
    // 输入即筛并回第 1 页：结果集变小后原页码可能越界
    const onKeywordChange = (value: string) => {
        setKeyword(value);
        setPage(1);
    };
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const onPageSizeChange = (size: number) => {
        setPageSize(size);
        setPage(1);
    };
    // 排序或翻页后行序变化，滚动区回到顶部，避免误以为排错行
    const tableScrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!scrollReset) return;
        if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
    }, [page, resetKey, scrollReset]);
    // 深链 ?new= 首帧即开弹窗（初始 state 直读）；effect 只负责清参数，不在副作用里开弹窗
    const [newOpen, setNewOpen] = useState(() => !!deepLinkNew && searchParams.get("new") === deepLinkNew);
    useEffect(() => {
        if (deepLinkNew && searchParams.get("new") === deepLinkNew) setSearchParams({}, { replace: true });
    }, [searchParams, setSearchParams, deepLinkNew]);
    return {
        keyword,
        setKeyword,
        onKeywordChange,
        page,
        setPage,
        pageSize,
        onPageSizeChange,
        tableScrollRef,
        newOpen,
        setNewOpen,
    };
}
