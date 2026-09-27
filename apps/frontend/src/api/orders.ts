import type { ArchiveOrderInput, CreateOrderInput, DeleteOrderInput, Order, UpdateOrderInput } from "./types";
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

/** 归档订单（仅超级管理员）：终态不可恢复，归档后移入归档订单页 */
export function archiveOrder(orderNo: string, input: ArchiveOrderInput): Promise<Order> {
    return requestClient.post<Order>(`/orders/${orderNo}/archive`, input, idempotencyConfig());
}

/** 删除净发货为零且关联出库已删除的订单（仅超级管理员）；列表立即隐藏 */
export function deleteOrder(orderNo: string, input: DeleteOrderInput): Promise<null> {
    return requestClient.post<null>(`/orders/${orderNo}/delete`, input, idempotencyConfig());
}
