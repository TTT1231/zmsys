import type { CreateOrderInput, Order, UpdateOrderInput } from "./types";
import { requestClient } from "@/http";

export function fetchOrders(): Promise<Order[]> {
    return requestClient.get<Order[]>("/orders");
}

export function createOrder(input: CreateOrderInput): Promise<Order> {
    return requestClient.post<Order>("/orders", input);
}

export function updateOrder(orderNo: string, input: UpdateOrderInput): Promise<Order> {
    return requestClient.put<Order>(`/orders/${orderNo}`, input);
}
