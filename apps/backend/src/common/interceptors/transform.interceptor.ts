import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';

export interface ResponseEnvelope<T> {
    code: number;
    data: T | null;
    message: string;
}

/** 统一响应信封：成功 {code: 0, data, message: 'ok'} */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ResponseEnvelope<T>> {
    intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ResponseEnvelope<T>> {
        return next.handle().pipe(map(data => ({ code: 0, data: data ?? null, message: 'ok' })));
    }
}
