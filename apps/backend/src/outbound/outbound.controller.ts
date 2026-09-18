import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { OutboundService } from "./outbound.service";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PERMISSIONS } from "../constants";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { CreateOutboundDto } from "./dto/create-outbound.dto";
import { VoidOutboundDto } from "./dto/void-outbound.dto";
import { PrintOutboundDto } from "./dto/print-outbound.dto";
import { EmergencyVoidOutboundDto } from "./dto/emergency-void-outbound.dto";
import type { AuthUser } from "../common/types/auth-user";
import type { OutboundPrintResult, OutboundRow } from "./types";

/** 成品出库（openapi outbound tag）：登记 → 打印放行；作废只追加冲销流水 */
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
    @Permissions([PERMISSIONS.OUTBOUND_VOID], "无权作废未打印出库")
    @HttpCode(HttpStatus.OK)
    async voidOutbound(
        @Param("no") no: string,
        @Body() dto: VoidOutboundDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<OutboundRow> {
        return this.outboundService.voidOutbound(no, dto, actor, idempotencyKey);
    }

    @Post(":no/print")
    @Permissions([PERMISSIONS.OUTBOUND_PRINT], "无权打印出库单")
    @HttpCode(HttpStatus.OK)
    async printOutbound(
        @Param("no") no: string,
        @Body() dto: PrintOutboundDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<OutboundPrintResult> {
        return this.outboundService.printOutbound(no, dto, actor, idempotencyKey);
    }

    @Post(":no/emergency-void")
    @Permissions([PERMISSIONS.OUTBOUND_EMERGENCY_VOID], "只有超级管理员可以紧急撤销")
    @HttpCode(HttpStatus.OK)
    async emergencyVoidOutbound(
        @Param("no") no: string,
        @Body() dto: EmergencyVoidOutboundDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<OutboundRow> {
        return this.outboundService.emergencyVoidOutbound(no, dto, actor, idempotencyKey);
    }
}
