import type { AxiosInstance, AxiosResponse } from "axios";
import type { RequestClientConfig, RequestClientOptions } from "./types";
import axios from "axios";
import { InterceptorManager } from "./interceptor-manager";

/* 参考 vben packages/effects/request 的 RequestClient（裁剪版）：
 * - 类型化 get/post/put/patch/delete，统一走 request()
 * - 拦截器经 InterceptorManager 注册，业务侧（client.ts）组装 token/信封等逻辑 */
export class RequestClient {
    public addRequestInterceptor: InterceptorManager["addRequestInterceptor"];
    public addResponseInterceptor: InterceptorManager["addResponseInterceptor"];

    public readonly instance: AxiosInstance;

    constructor(options: RequestClientOptions = {}) {
        const defaultConfig: RequestClientOptions = {
            headers: { "Content-Type": "application/json;charset=utf-8" },
            timeout: 15_000,
        };
        this.instance = axios.create({ ...defaultConfig, ...options });

        const interceptorManager = new InterceptorManager(this.instance);
        this.addRequestInterceptor = interceptorManager.addRequestInterceptor.bind(interceptorManager);
        this.addResponseInterceptor = interceptorManager.addResponseInterceptor.bind(interceptorManager);
    }

    public get<T>(url: string, config?: RequestClientConfig): Promise<T> {
        return this.request<T>(url, { ...config, method: "GET" });
    }

    public post<T>(url: string, data?: unknown, config?: RequestClientConfig): Promise<T> {
        return this.request<T>(url, { ...config, data, method: "POST" });
    }

    public put<T>(url: string, data?: unknown, config?: RequestClientConfig): Promise<T> {
        return this.request<T>(url, { ...config, data, method: "PUT" });
    }

    public patch<T>(url: string, data?: unknown, config?: RequestClientConfig): Promise<T> {
        return this.request<T>(url, { ...config, data, method: "PATCH" });
    }

    public delete<T>(url: string, config?: RequestClientConfig): Promise<T> {
        return this.request<T>(url, { ...config, method: "DELETE" });
    }

    /** 通用请求：响应拦截器已将信封解包为业务数据，这里实际拿到的就是 data 本身 */
    public async request<T>(url: string, config: RequestClientConfig): Promise<T> {
        const response: AxiosResponse<T> = await this.instance({ url, ...config });
        return response as unknown as T;
    }
}
