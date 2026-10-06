import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Put } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PERMISSIONS } from "../constants";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { CreateOrderDto } from "./dto/create-order.dto";
import { UpdateOrderDto } from "./dto/update-order.dto";
import { ArchiveOrderDto } from "./dto/archive-order.dto";
import { UnarchiveOrderDto } from "./dto/unarchive-order.dto";
import { ExpectedVersionDto } from "../common/dto/expected-version.dto";
import type { AuthUser } from "../common/types/auth-user";
import type { Order } from "./types";

/** 销售订单（openapi orders tag）：归档为生命周期终态（仅归档操作人本人可回退）；
 * 净发货为零且关联出库单已删除的订单可由超级管理员软删除（专用端点 :orderNo/delete）；
 * 已完成/部分发货的订单由超级管理员归档（:orderNo/archive）退出活跃视图，
 * 误归档由归档人经 :orderNo/unarchive 回退回活跃视图 */
@Controller("orders")
export class OrdersController {
    constructor(private readonly ordersService: OrdersService) {}

    @Get()
    @Permissions([PERMISSIONS.ORDERS_VIEW], "无权查看订单列表")
    async listOrders(): Promise<Order[]> {
        return this.ordersService.listOrders();
    }

    @Post()
    @Permissions([PERMISSIONS.ORDERS_CREATE], "无权新建订单")
    @HttpCode(HttpStatus.OK) // openapi 契约为 200，覆盖 @Post 默认的 201
    async createOrder(
        @Body() dto: CreateOrderDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<Order> {
        return this.ordersService.createOrder(dto, actor, idempotencyKey);
    }

    @Put(":orderNo")
    @Permissions([PERMISSIONS.ORDERS_EDIT], "无权修改订单")
    async updateOrder(
        @Param("orderNo") orderNo: string,
        @Body() dto: UpdateOrderDto,
        @CurrentUser() actor: AuthUser,
    ): Promise<Order> {
        return this.ordersService.updateOrder(orderNo, dto, actor);
    }

    @Post(":orderNo/archive")
    @Permissions([PERMISSIONS.ORDERS_ARCHIVE], "只有超级管理员可以归档销售订单")
    @HttpCode(HttpStatus.OK)
    async archiveOrder(
        @Param("orderNo") orderNo: string,
        @Body() dto: ArchiveOrderDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<Order> {
        return this.ordersService.archiveOrder(orderNo, dto, actor, idempotencyKey);
    }

    @Post(":orderNo/unarchive")
    @Permissions([PERMISSIONS.ORDERS_UNARCHIVE], "只有超级管理员可以回退归档订单")
    @HttpCode(HttpStatus.OK)
    async unarchiveOrder(
        @Param("orderNo") orderNo: string,
        @Body() dto: UnarchiveOrderDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<Order> {
        return this.ordersService.unarchiveOrder(orderNo, dto, actor, idempotencyKey);
    }

    @Post(":orderNo/delete")
    @Permissions([PERMISSIONS.ORDERS_DELETE], "只有超级管理员可以删除销售订单")
    @HttpCode(HttpStatus.OK)
    async deleteOrder(
        @Param("orderNo") orderNo: string,
        @Body() dto: ExpectedVersionDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<null> {
        return this.ordersService.deleteOrder(orderNo, dto, actor, idempotencyKey);
    }
}
