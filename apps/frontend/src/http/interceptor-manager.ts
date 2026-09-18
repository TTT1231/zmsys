import type { AxiosInstance } from "axios";
import type { RequestInterceptorConfig, ResponseInterceptorConfig } from "./types";

/* 拦截器管理：包装 axios 的注册 API，保持与 vben RequestClient 相同的组装方式 */
class InterceptorManager {
    private axiosInstance: AxiosInstance;

    constructor(instance: AxiosInstance) {
        this.axiosInstance = instance;
    }

    addRequestInterceptor({ fulfilled, rejected }: RequestInterceptorConfig = {}) {
        this.axiosInstance.interceptors.request.use(
            fulfilled ?? (config => config),
            rejected ?? (error => Promise.reject(error)),
        );
    }

    addResponseInterceptor<T = unknown>({ fulfilled, rejected }: ResponseInterceptorConfig<T> = {}) {
        this.axiosInstance.interceptors.response.use(fulfilled as never, rejected ?? (error => Promise.reject(error)));
    }
}

export { InterceptorManager };
