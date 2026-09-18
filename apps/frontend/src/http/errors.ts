/** 业务/HTTP 错误的统一载体：拦截器把各种失败归一成它，页面 catch 后直接 toast message */
export class ApiError extends Error {
    /** 业务码或 HTTP 状态码；-1 表示无响应（网络层失败） */
    readonly code: number;

    constructor(message: string, code: number) {
        super(message);
        this.name = "ApiError";
        this.code = code;
    }
}

export function isApiError(error: unknown): error is ApiError {
    return error instanceof ApiError;
}
