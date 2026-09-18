import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { TransactionRetryExhaustedError } from "../errors/transaction-retry-exhausted.error";

/** Fastify reply 的最小结构类型，避免直接依赖 fastify 包类型 */
interface ResponseLike {
    status: (code: number) => { send: (body: unknown) => unknown };
}

/** Fastify request 的最小结构：id 即请求标识（Fastify 自带递增 reqId） */
interface RequestLike {
    id?: string | number;
}

/** MariaDB 驱动的死锁 / 锁等待超时：errno 1213/1205 或语义 code */
const isDeadlockOrLockTimeout = (exception: unknown): boolean => {
    if (typeof exception !== "object" || exception === null) {
        return false;
    }
    const candidate = exception as { errno?: unknown; code?: unknown };
    return (
        candidate.errno === 1213 ||
        candidate.errno === 1205 ||
        candidate.code === "ER_LOCK_DEADLOCK" ||
        candidate.code === "ER_LOCK_WAIT_TIMEOUT"
    );
};

/**
 * 统一错误信封与数据库错误识别（单过滤器完成，不依赖过滤器链次序——
 * Nest 按异常类型择最具体者匹配，而非串行穿透）：{code: HTTP 状态码, data: null, message}。
 * 契约要求唯一冲突/乐观锁/死锁不得统一落成 500；500 分支记录原始异常与 requestId，不对外泄露细节。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger = new Logger(AllExceptionsFilter.name);

    catch(exception: unknown, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<ResponseLike>();
        const requestId = ctx.getRequest<RequestLike | undefined>()?.id;

        const mapped = this.mapException(exception);
        if (mapped.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
            const stack = exception instanceof Error ? exception.stack : undefined;
            const prefix = requestId === undefined ? "" : `[req ${requestId}] `;
            this.logger.error(`${prefix}${exception instanceof Error ? exception.message : String(exception)}`, stack);
        }

        response.status(mapped.status).send({ code: mapped.status, data: null, message: mapped.message });
    }

    private mapException(exception: unknown): { status: HttpStatus; message: string } {
        if (exception instanceof HttpException) {
            return { status: exception.getStatus() as HttpStatus, message: this.extractMessage(exception) };
        }
        if (exception instanceof TransactionRetryExhaustedError) {
            return { status: HttpStatus.SERVICE_UNAVAILABLE, message: "并发冲突，请稍后重试" };
        }
        if (exception instanceof Prisma.PrismaClientKnownRequestError) {
            return this.mapPrismaKnownError(exception);
        }
        if (isDeadlockOrLockTimeout(exception)) {
            return { status: HttpStatus.SERVICE_UNAVAILABLE, message: "数据库锁冲突，请稍后重试" };
        }
        return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: "服务器内部错误" };
    }

    /** Prisma 已知错误码 → 契约 HTTP 语义；未列出的码按未知错误落 500 并记录日志 */
    private mapPrismaKnownError(error: Prisma.PrismaClientKnownRequestError): { status: HttpStatus; message: string } {
        switch (error.code) {
            case "P2002": {
                const target = error.meta?.target;
                const label = Array.isArray(target) ? target.join("、") : typeof target === "string" ? target : "";
                return {
                    status: HttpStatus.CONFLICT,
                    message: label ? `数据已存在（${label}）` : "数据已存在，无法重复创建",
                };
            }
            case "P2025":
                return { status: HttpStatus.NOT_FOUND, message: "记录不存在或已被删除" };
            case "P2034":
                return { status: HttpStatus.SERVICE_UNAVAILABLE, message: "并发冲突，请稍后重试" };
            default:
                return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: "服务器内部错误" };
        }
    }

    private extractMessage(exception: HttpException): string {
        const payload = exception.getResponse();
        if (typeof payload === "string") {
            return payload;
        }
        if (payload && typeof payload === "object" && "message" in payload) {
            const raw = (payload as { message?: unknown }).message;
            // ValidationPipe 的校验错误是数组，拼接为一句
            if (Array.isArray(raw)) {
                return raw.map(item => String(item)).join("；");
            }
            return String(raw);
        }
        return exception.message;
    }
}
