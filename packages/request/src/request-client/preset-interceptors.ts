import type { RequestClient } from "./request-client";
import type { MakeErrorMessageFn, ResponseInterceptorConfig } from "./types";

import { isFunction } from "@zmsys/utils";

import axios from "axios";

/** 常用的 HTTP 错误提示文案，如需国际化可在外层替换 */
const httpErrorMessages = {
    badRequest: "请求参数错误",
    forbidden: "没有访问权限",
    internalServerError: "服务器内部错误，请稍后再试",
    networkError: "网络异常，请检查网络连接后重试",
    notFound: "请求的资源不存在",
    requestTimeout: "请求超时，请稍后再试",
    unauthorized: "登录已过期或未授权，请重新登录",
};

export const defaultResponseInterceptor = ({
    codeField = "code",
    dataField = "data",
    successCode = 0,
}: {
    /** 响应数据中代表访问结果的字段名 */
    codeField: string;
    /** 响应数据中装载实际数据的字段名，或者提供一个函数从响应数据中解析需要返回的数据 */
    dataField: ((response: any) => any) | string;
    /** 当codeField所指定的字段值与successCode相同时，代表接口访问成功。如果提供一个函数，则返回true代表接口访问成功 */
    successCode: ((code: any) => boolean) | number | string;
}): ResponseInterceptorConfig => {
    return {
        fulfilled: response => {
            const { config, data: responseData, status } = response;

            if (config.responseReturn === "raw") {
                return response;
            }

            if (status >= 200 && status < 400) {
                if (config.responseReturn === "body") {
                    return responseData;
                } else if (
                    isFunction(successCode)
                        ? successCode(responseData[codeField])
                        : responseData[codeField] === successCode
                ) {
                    return isFunction(dataField) ? dataField(responseData) : responseData[dataField];
                }
            }
            throw Object.assign({}, response, { response });
        },
    };
};

export const authenticateResponseInterceptor = ({
    client,
    doReAuthenticate,
    doRefreshToken,
    enableRefreshToken,
    formatToken,
}: {
    client: RequestClient;
    doReAuthenticate: () => Promise<void>;
    doRefreshToken: () => Promise<string>;
    enableRefreshToken: boolean;
    formatToken: (token: string) => null | string;
}): ResponseInterceptorConfig => {
    return {
        rejected: async error => {
            const { config, response } = error;
            // 如果不是 401 错误，直接抛出异常
            if (response?.status !== 401) {
                throw error;
            }
            // 判断是否启用了 refreshToken 功能
            // 如果没有启用或者已经是重试请求了，直接跳转到重新登录
            if (!enableRefreshToken || config.__isRetryRequest) {
                await doReAuthenticate();
                throw error;
            }
            // 如果正在刷新 token，则将请求加入队列，等待刷新完成
            if (client.isRefreshing) {
                return new Promise(resolve => {
                    client.refreshTokenQueue.push((newToken: string) => {
                        config.headers.Authorization = formatToken(newToken);
                        resolve(client.request(config.url, { ...config }));
                    });
                });
            }

            // 标记开始刷新 token
            client.isRefreshing = true;
            // 标记当前请求为重试请求，避免无限循环
            config.__isRetryRequest = true;

            try {
                const newToken = await doRefreshToken();

                // 处理队列中的请求
                client.refreshTokenQueue.forEach(callback => callback(newToken));
                // 清空队列
                client.refreshTokenQueue = [];

                return client.request(error.config.url, { ...error.config });
            } catch (refreshError) {
                // 如果刷新 token 失败，处理错误（如强制登出或跳转登录页面）
                client.refreshTokenQueue.forEach(callback => callback(""));
                client.refreshTokenQueue = [];
                console.error("Refresh token failed, please login again.");
                await doReAuthenticate();

                throw refreshError;
            } finally {
                client.isRefreshing = false;
            }
        },
    };
};

export const errorMessageResponseInterceptor = (makeErrorMessage?: MakeErrorMessageFn): ResponseInterceptorConfig => {
    return {
        rejected: (error: any) => {
            if (axios.isCancel(error)) {
                return Promise.reject(error);
            }

            const err: string = error?.toString?.() ?? "";
            let errMsg = "";
            if (err?.includes("Network Error")) {
                errMsg = httpErrorMessages.networkError;
            } else if (error?.message?.includes?.("timeout")) {
                errMsg = httpErrorMessages.requestTimeout;
            }
            if (errMsg) {
                makeErrorMessage?.(errMsg, error);
                return Promise.reject(error);
            }

            let errorMessage: string;
            const status = error?.response?.status;

            switch (status) {
                case 400: {
                    errorMessage = httpErrorMessages.badRequest;
                    break;
                }
                case 401: {
                    errorMessage = httpErrorMessages.unauthorized;
                    break;
                }
                case 403: {
                    errorMessage = httpErrorMessages.forbidden;
                    break;
                }
                case 404: {
                    errorMessage = httpErrorMessages.notFound;
                    break;
                }
                case 408: {
                    errorMessage = httpErrorMessages.requestTimeout;
                    break;
                }
                default: {
                    errorMessage = httpErrorMessages.internalServerError;
                }
            }
            makeErrorMessage?.(errorMessage, error);
            return Promise.reject(error);
        },
    };
};
