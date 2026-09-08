import type { HttpResponse } from "./types";
import axios from "axios";
import { RequestClient } from "./request-client";
import { ApiError } from "./errors";
import { clearToken, getToken } from "./token";

export const requestClient = new RequestClient({
    baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
});

/* 请求拦截：注入 accessToken */
requestClient.addRequestInterceptor({
    fulfilled: config => {
        const token = getToken();
        if (token) config.headers.Authorization = `Bearer ${token}`;
        return config;
    },
});

/* 响应拦截 ①：解包 {code, data, message} 信封（注册在前，业务错误抛给 ② 归一化） */
requestClient.addResponseInterceptor({
    fulfilled: response => {
        const body = response.data as HttpResponse | undefined;
        // 非信封响应（文件流等）直接放行
        if (typeof body !== "object" || body === null || typeof body.code !== "number") {
            return response;
        }
        if (response.status >= 200 && response.status < 400 && body.code === 0) {
            // 用解包后的 data 冒充 AxiosResponse 向下传递（与 vben 同款约定）
            return body.data as never;
        }
        throw new ApiError(body.message || "请求失败", body.code);
    },
});

/* 响应拦截 ②：错误归一化 + 401 登出跳转 */
requestClient.addResponseInterceptor({
    rejected: (error: unknown) => {
        if (axios.isCancel(error) || error instanceof ApiError) return Promise.reject(error);

        const status = (error as { response?: { status?: number } })?.response?.status ?? -1;
        const serverMessage = (error as { response?: { data?: HttpResponse } })?.response?.data?.message;
        const message =
            serverMessage ||
            (status === 401
                ? "登录已过期，请重新登录"
                : status === 403
                  ? "没有执行该操作的权限"
                  : status === 404
                    ? "请求的资源不存在"
                    : status === -1
                      ? "网络异常，请检查网络连接"
                      : `请求失败（HTTP ${status}）`);

        // 401：凭证失效，清除本地登录态并回到登录页（登录接口本身用 400，不会误伤）
        if (status === 401) {
            clearToken();
            if (!window.location.pathname.startsWith("/login")) {
                window.location.replace("/login");
            }
        }
        return Promise.reject(new ApiError(message, status));
    },
});
