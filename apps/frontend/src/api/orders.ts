import type { CancelOrderInput, CreateOrderInput, DeleteOrderInput, Order, UpdateOrderInput } from "./types";
import { requestClient } from "@/http";
import { idempotencyConfig } from "./idempotency";

export function fetchOrders(): Promise<Order[]> {
    return requestClient.get<Order[]>("/orders");
}

export function createOrder(input: CreateOrderInput): Promise<Order> {
    return requestClient.post<Order>("/orders", input, idempotencyConfig());
}

export function updateOrder(orderNo: string, input: UpdateOrderInput): Promise<Order> {
    return requestClient.put<Order>(`/orders/${orderNo}`, input);
}

export function cancelOrder(orderNo: string, input: CancelOrderInput): Promise<Order> {
    return requestClient.post<Order>(`/orders/${orderNo}/cancel`, input, idempotencyConfig());
}

/** 删除完全未发货的订单（仅超级管理员）；订单移除后不再返回 */
export function deleteOrder(orderNo: string, input: DeleteOrderInput): Promise<null> {
    return requestClient.post<null>(`/orders/${orderNo}/delete`, input, idempotencyConfig());
}
