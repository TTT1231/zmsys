import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { OutboundService } from "./outbound.service";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PERMISSIONS } from "../constants";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { CreateOutboundDto } from "./dto/create-outbound.dto";
import { VoidResourceDto } from "../common/dto/void-resource.dto";
import { ExpectedVersionDto } from "../common/dto/expected-version.dto";
import type { AuthUser } from "../common/types/auth-user";
import type { OutboundRow } from "./types";

/** 成品出库（openapi outbound tag）：登记/作废/删除；作废只追加冲销流水 */
@Controller("outbound")
export class OutboundController {
    constructor(private readonly outboundService: OutboundService) {}

    @Get()
    @Permissions([PERMISSIONS.OUTBOUND_VIEW], "无权查看出库台账")
    async listOutbound(): Promise<OutboundRow[]> {
        return this.outboundService.listOutbound();
    }

    @Post()
    @Permissions([PERMISSIONS.OUTBOUND_SHIP], "无权登记发货")
    @HttpCode(HttpStatus.OK)
    async createOutbound(
        @Body() dto: CreateOutboundDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<OutboundRow> {
        return this.outboundService.createOutbound(dto, actor, idempotencyKey);
    }

    @Post(":no/void")
    @Permissions([PERMISSIONS.OUTBOUND_VOID], "无权作废出库单")
    @HttpCode(HttpStatus.OK)
    async voidOutbound(
        @Param("no") no: string,
        @Body() dto: VoidResourceDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<OutboundRow> {
        return this.outboundService.voidOutbound(no, dto, actor, idempotencyKey);
    }

    @Post(":no/delete")
    @Permissions([PERMISSIONS.OUTBOUND_DELETE], "无权删除出库单")
    @HttpCode(HttpStatus.OK)
    async deleteOutbound(
        @Param("no") no: string,
        @Body() dto: ExpectedVersionDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<null> {
        return this.outboundService.deleteOutbound(no, dto, actor, idempotencyKey);
    }
}
