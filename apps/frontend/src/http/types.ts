import type { AxiosRequestConfig, AxiosResponse, CreateAxiosDefaults, InternalAxiosRequestConfig } from "axios";

/** 统一响应信封：code 为 0 表示成功，非 0 为业务错误 */
export interface HttpResponse<T = unknown> {
    code: number;
    data: T;
    message: string;
}

export type RequestClientOptions = CreateAxiosDefaults;

export type RequestClientConfig<T = unknown> = AxiosRequestConfig<T>;

export interface RequestInterceptorConfig {
    fulfilled?: (
        config: InternalAxiosRequestConfig,
    ) => InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig>;
    rejected?: (error: unknown) => unknown;
}

export interface ResponseInterceptorConfig<T = unknown> {
    fulfilled?: (response: AxiosResponse<T>) => AxiosResponse<T> | Promise<AxiosResponse<T>>;
    rejected?: (error: unknown) => unknown;
}
