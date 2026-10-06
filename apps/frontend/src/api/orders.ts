import type {
    ArchiveOrderInput,
    CreateOrderInput,
    DeleteOrderInput,
    Order,
    UnarchiveOrderInput,
    UpdateOrderInput,
} from "./types";
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

/** 归档订单（仅超级管理员）：归档后移入归档订单页，仅归档操作人本人可回退 */
export function archiveOrder(orderNo: string, input: ArchiveOrderInput): Promise<Order> {
    return requestClient.post<Order>(`/orders/${orderNo}/archive`, input, idempotencyConfig());
}

/** 回退归档（仅归档操作人本人，超级管理员）：订单退回 ACTIVE，返回销售订单页恢复编辑 */
export function unarchiveOrder(orderNo: string, input: UnarchiveOrderInput): Promise<Order> {
    return requestClient.post<Order>(`/orders/${orderNo}/unarchive`, input, idempotencyConfig());
}

/** 删除净发货为零且关联出库已删除的订单（仅超级管理员）；列表立即隐藏 */
export function deleteOrder(orderNo: string, input: DeleteOrderInput): Promise<null> {
    return requestClient.post<null>(`/orders/${orderNo}/delete`, input, idempotencyConfig());
}
