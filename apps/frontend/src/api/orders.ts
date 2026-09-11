import type { CancelOrderInput, CreateOrderInput, Order, UpdateOrderInput } from "./types";
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
