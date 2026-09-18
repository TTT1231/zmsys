/**
 * e2e 测试专用 Controller：基础设施完成时生产应用尚无业务写端点，
 * 以此验证幂等 HTTP 层（头校验、重放信封、409 形态）与
 * IdempotencyService + TransactionRunner + BusinessSequenceService 的完整组合。
 * 仅存在于测试模块图，不进 src/ 生产代码。
 */
import { Body, Controller, HttpCode, HttpStatus, Param, Post, Headers } from "@nestjs/common";
import { IdempotencyService } from "../src/idempotency/idempotency.service";
import { TransactionRunner } from "../src/prisma/transaction.runner";
import { BusinessSequenceService } from "../src/sequence/business-sequence.service";
import { AuthenticatedOnly } from "../src/common/decorators/authenticated-only.decorator";
import { CurrentUser } from "../src/common/decorators/current-user.decorator";
import type { AuthUser } from "../src/common/types/auth-user";

@Controller("test/idempotent/:scope")
export class TestIdempotencyController {
    constructor(
        private readonly idempotency: IdempotencyService,
        private readonly runner: TransactionRunner,
        private readonly sequence: BusinessSequenceService,
    ) {}

    /** 契约样例：创建类 POST 带 Idempotency-Key；重放返回原成功响应体 */
    @AuthenticatedOnly()
    @Post()
    @HttpCode(HttpStatus.OK)
    async create(
        @Param("scope") scope: string,
        @Headers("idempotency-key") keyHeader: string | undefined,
        @Body() body: { payload?: string },
        @CurrentUser() actor: AuthUser,
    ): Promise<{ code: string }> {
        const key = this.idempotency.requireKey(keyHeader);
        const requestHash = this.idempotency.digest({ method: "POST", pathParams: { scope }, body });
        return this.runner.run(async tx => {
            const begin = await this.idempotency.beginOrReplay(tx, {
                actorId: BigInt(actor.id),
                operationKey: `test:${scope}`,
                key,
                requestHash,
            });
            if (begin.replay) {
                return begin.replay.body as { code: string };
            }
            const code = await this.sequence.nextCode(tx, "customer", "2026-09-11");
            const responseBody = { code };
            await this.idempotency.complete(tx, {
                id: begin.placeholderId!,
                httpStatus: 200,
                responseBody,
                resource: { type: "test", code },
            });
            return responseBody;
        });
    }
}
