import type { AxiosInstance, AxiosResponse } from "axios";

import type { RequestClientConfig, RequestClientOptions } from "./types";

import { bindMethods, isString, merge } from "@zmsys/utils";

import axios from "axios";
import qs from "qs";

import { FileDownloader } from "./modules/downloader";
import { InterceptorManager } from "./modules/interceptor";
import { SSE } from "./modules/sse";
import { FileUploader } from "./modules/uploader";

function getParamsSerializer(paramsSerializer: RequestClientOptions["paramsSerializer"]) {
    if (isString(paramsSerializer)) {
        switch (paramsSerializer) {
            case "brackets": {
                return (params: any) => qs.stringify(params, { arrayFormat: "brackets" });
            }
            case "comma": {
                return (params: any) => qs.stringify(params, { arrayFormat: "comma" });
            }
            case "indices": {
                return (params: any) => qs.stringify(params, { arrayFormat: "indices" });
            }
            case "repeat": {
                return (params: any) => qs.stringify(params, { arrayFormat: "repeat" });
            }
        }
    }
    return paramsSerializer;
}

class RequestClient {
    public addRequestInterceptor: InterceptorManager["addRequestInterceptor"];

    public addResponseInterceptor: InterceptorManager["addResponseInterceptor"];
    public download: FileDownloader["download"];

    public readonly instance: AxiosInstance;
    public isRefreshing = false;
    public postSSE: SSE["postSSE"];
    public refreshTokenQueue: ((token: string) => void)[] = [];
    public requestSSE: SSE["requestSSE"];
    public upload: FileUploader["upload"];

    constructor(options: RequestClientOptions = {}) {
        const defaultConfig: RequestClientOptions = {
            headers: {
                "Content-Type": "application/json;charset=utf-8",
            },
            responseReturn: "raw",
            // 默认超时时间
            timeout: 10_000,
        };
        const requestConfig = merge({}, defaultConfig, options);
        requestConfig.paramsSerializer = getParamsSerializer(requestConfig.paramsSerializer);
        this.instance = axios.create(requestConfig);

        bindMethods(this);

        const interceptorManager = new InterceptorManager(this.instance);
        this.addRequestInterceptor = interceptorManager.addRequestInterceptor.bind(interceptorManager);
        this.addResponseInterceptor = interceptorManager.addResponseInterceptor.bind(interceptorManager);

        const fileUploader = new FileUploader(this);
        this.upload = fileUploader.upload.bind(fileUploader);
        const fileDownloader = new FileDownloader(this);
        this.download = fileDownloader.download.bind(fileDownloader);
        const sse = new SSE(this);
        this.postSSE = sse.postSSE.bind(sse);
        this.requestSSE = sse.requestSSE.bind(sse);
    }

    public delete<T = any>(url: string, config?: RequestClientConfig): Promise<T> {
        return this.request<T>(url, { ...config, method: "DELETE" });
    }

    public get<T = any>(url: string, config?: RequestClientConfig): Promise<T> {
        return this.request<T>(url, { ...config, method: "GET" });
    }

    public getBaseUrl() {
        return this.instance.defaults.baseURL;
    }

    public post<T = any>(url: string, data?: any, config?: RequestClientConfig): Promise<T> {
        return this.request<T>(url, { ...config, data, method: "POST" });
    }

    public put<T = any>(url: string, data?: any, config?: RequestClientConfig): Promise<T> {
        return this.request<T>(url, { ...config, data, method: "PUT" });
    }

    public patch<T = any>(url: string, data?: any, config?: RequestClientConfig): Promise<T> {
        return this.request<T>(url, { ...config, data, method: "PATCH" });
    }

    public async request<T>(url: string, config: RequestClientConfig): Promise<T> {
        const response: AxiosResponse<T> = await this.instance({
            url,
            ...config,
            ...(config.paramsSerializer ? { paramsSerializer: getParamsSerializer(config.paramsSerializer) } : {}),
        });
        return response as T;
    }
}

export { RequestClient };
