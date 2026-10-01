import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Put } from "@nestjs/common";
import { InboundService } from "./inbound.service";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PERMISSIONS } from "../constants";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { CreateInboundDto } from "./dto/create-inbound.dto";
import { UpdateInboundDto } from "./dto/update-inbound.dto";
import { CreateStockAdjustmentDto } from "./dto/create-stock-adjustment.dto";
import { VoidResourceDto } from "../common/dto/void-resource.dto";
import { ExpectedVersionDto } from "../common/dto/expected-version.dto";
import type { AuthUser } from "../common/types/auth-user";
import type { InboundRow, StockAdjustmentRow } from "./types";

/** 成品入库与跨日库存调整（openapi inbound tag）：当天可修正，跨日只追加调整 */
@Controller()
export class InboundController {
    constructor(private readonly inboundService: InboundService) {}

    @Get("inbound")
    @Permissions([PERMISSIONS.INBOUND_VIEW], "无权查看入库台账")
    async listInbound(): Promise<InboundRow[]> {
        return this.inboundService.listInbound();
    }

    @Post("inbound")
    @Permissions([PERMISSIONS.INBOUND_REGISTER], "无权登记入库")
    @HttpCode(HttpStatus.OK)
    async createInbound(
        @Body() dto: CreateInboundDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<InboundRow> {
        return this.inboundService.createInbound(dto, actor, idempotencyKey);
    }

    @Put("inbound/:no")
    @Permissions([PERMISSIONS.INBOUND_EDIT], "无权修正入库")
    async updateInbound(
        @Param("no") no: string,
        @Body() dto: UpdateInboundDto,
        @CurrentUser() actor: AuthUser,
    ): Promise<InboundRow> {
        return this.inboundService.updateInbound(no, dto, actor);
    }

    @Post("inbound/:no/void")
    @Permissions([PERMISSIONS.INBOUND_EDIT], "无权作废入库")
    @HttpCode(HttpStatus.OK)
    async voidInbound(
        @Param("no") no: string,
        @Body() dto: VoidResourceDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<InboundRow> {
        return this.inboundService.voidInbound(no, dto, actor, idempotencyKey);
    }

    @Post("inbound/:no/delete")
    @Permissions([PERMISSIONS.INBOUND_DELETE], "无权删除入库记录")
    @HttpCode(HttpStatus.OK)
    async deleteInbound(
        @Param("no") no: string,
        @Body() dto: ExpectedVersionDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<null> {
        return this.inboundService.deleteInbound(no, dto, actor, idempotencyKey);
    }

    @Get("stock-adjustments")
    @Permissions([PERMISSIONS.INBOUND_VIEW], "无权查看库存调整")
    async listStockAdjustments(): Promise<StockAdjustmentRow[]> {
        return this.inboundService.listStockAdjustments();
    }

    @Post("stock-adjustments")
    @Permissions([PERMISSIONS.INBOUND_ADJUST], "只有超级管理员可以执行跨日库存调整")
    @HttpCode(HttpStatus.OK)
    async createStockAdjustment(
        @Body() dto: CreateStockAdjustmentDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<StockAdjustmentRow> {
        return this.inboundService.createStockAdjustment(dto, actor, idempotencyKey);
    }
}
