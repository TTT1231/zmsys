import { isRouteErrorResponse } from "react-router";

import type { ErrorPageKind } from "./ErrorPage";

/** 将 React Router 的响应错误映射为用户能理解的错误状态。 */
export function errorPageKindForRouteError(error: unknown): ErrorPageKind {
    if (isRouteErrorResponse(error)) {
        if (error.status === 403) return "forbidden";
        if (error.status === 404) return "not-found";
    }
    return "server";
}
