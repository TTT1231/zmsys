import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

/** Fastify reply 的最小结构类型，避免直接依赖 fastify 包类型 */
interface ResponseLike {
    status: (code: number) => { send: (body: unknown) => unknown };
}

/** 统一错误信封：{code: HTTP 状态码, data: null, message}，不泄露内部堆栈 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost): void {
        const response = host.switchToHttp().getResponse<ResponseLike>();

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let message = '服务器内部错误';
        if (exception instanceof HttpException) {
            status = exception.getStatus();
            message = this.extractMessage(exception);
        }

        response.status(status).send({ code: status, data: null, message });
    }

    private extractMessage(exception: HttpException): string {
        const payload = exception.getResponse();
        if (typeof payload === 'string') {
            return payload;
        }
        if (payload && typeof payload === 'object' && 'message' in payload) {
            const raw = (payload as { message?: unknown }).message;
            // ValidationPipe 的校验错误是数组，拼接为一句
            if (Array.isArray(raw)) {
                return raw.map(item => String(item)).join('；');
            }
            return String(raw);
        }
        return exception.message;
    }
}
