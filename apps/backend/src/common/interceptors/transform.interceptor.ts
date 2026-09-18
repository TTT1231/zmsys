import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { map, Observable } from "rxjs";

export interface ResponseEnvelope<T> {
    code: number;
    data: T | null;
    message: string;
}

/**
 * BigInt 的 JSON 序列化约定：安全整数范围内转 number（契约 version: integer，
 * row_version 等小值计数器），超出 ±2^53 的（Snowflake 主键等）转十进制字符串——
 * 否则 Fastify 默认 JSON.stringify 对 BigInt 直接抛 TypeError（500）。
 */
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = -MAX_SAFE;

const normalize = (value: unknown): unknown => {
    if (typeof value === "bigint") {
        return value >= MIN_SAFE && value <= MAX_SAFE ? Number(value) : value.toString();
    }
    if (Array.isArray(value)) {
        return value.map(normalize);
    }
    // Date 交由序列化层输出 ISO（契约 date-time）；TypedArray/Buffer（Bytes 列）不进响应，原样放行
    if (value !== null && typeof value === "object" && !(value instanceof Date) && !ArrayBuffer.isView(value)) {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalize(item)]),
        );
    }
    return value;
};

/** 统一响应信封：成功 {code: 0, data, message: 'ok'}；data 递归做 BigInt 规范化 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ResponseEnvelope<T>> {
    intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ResponseEnvelope<T>> {
        return next.handle().pipe(map(data => ({ code: 0, data: normalize(data ?? null) as T, message: "ok" })));
    }
}
