import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { BomsService } from "./boms.service";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PERMISSIONS } from "../constants";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { CreateBomDto } from "./dto/create-bom.dto";
import type { AuthUser } from "../common/types/auth-user";
import type { Bom } from "./types";

/** BOM/成品档案（openapi boms tag）：规格变化只能新建；未被订单/台账引用的
 * 手误档案可由超级管理员物理删除，已引用档案保留原状 */
@Controller("boms")
export class BomsController {
    constructor(private readonly bomsService: BomsService) {}

    @Get()
    @Permissions([PERMISSIONS.BOM_VIEW], "无权查看 BOM")
    async listBoms(): Promise<Bom[]> {
        return this.bomsService.listBoms();
    }

    @Post()
    @Permissions([PERMISSIONS.BOM_CREATE], "无权新建 BOM")
    @HttpCode(HttpStatus.OK) // openapi 契约为 200，覆盖 @Post 默认的 201
    async createBom(
        @Body() dto: CreateBomDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<Bom> {
        return this.bomsService.createBom(dto, actor, idempotencyKey);
    }

    @Post(":code/delete")
    @Permissions([PERMISSIONS.BOM_DELETE], "只有超级管理员可以删除 BOM")
    @HttpCode(HttpStatus.OK) // openapi 契约为 200，覆盖 @Post 默认的 201
    async deleteBom(
        @Param("code") code: string,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<null> {
        return this.bomsService.deleteBom(code, actor, idempotencyKey);
    }
}
