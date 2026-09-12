/* 演示数据接入点：后续在此替换为聚合接口查询，页面与纯统计函数无需改写。 */
import { useMemo } from "react";
import { createWorkbenchDemo } from "../../../mocks/data/workbench";

export function useWorkbenchData() {
    const asOf = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
    return useMemo(() => createWorkbenchDemo(asOf), [asOf]);
}
