import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Put } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PERMISSIONS } from "../constants";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { CreateOrderDto } from "./dto/create-order.dto";
import { UpdateOrderDto } from "./dto/update-order.dto";
import { CancelOrderDto } from "./dto/cancel-order.dto";
import { DeleteOrderDto } from "./dto/delete-order.dto";
import type { AuthUser } from "../common/types/auth-user";
import type { Order } from "./types";

/** 销售订单（openapi orders tag）：取消为生命周期终态；完全未发货的手误订单
 * 可由超级管理员物理删除（专用端点 :orderNo/delete），已发货订单只能取消 */
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

    @Post(":orderNo/cancel")
    @Permissions([PERMISSIONS.ORDERS_CANCEL], "无权取消订单")
    @HttpCode(HttpStatus.OK)
    async cancelOrder(
        @Param("orderNo") orderNo: string,
        @Body() dto: CancelOrderDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<Order> {
        return this.ordersService.cancelOrder(orderNo, dto, actor, idempotencyKey);
    }

    @Post(":orderNo/delete")
    @Permissions([PERMISSIONS.ORDERS_DELETE], "只有超级管理员可以删除销售订单")
    @HttpCode(HttpStatus.OK)
    async deleteOrder(
        @Param("orderNo") orderNo: string,
        @Body() dto: DeleteOrderDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<null> {
        return this.ordersService.deleteOrder(orderNo, dto, actor, idempotencyKey);
    }
}
