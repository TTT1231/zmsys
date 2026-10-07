import type { CreateOutboundInput, DeleteOutboundInput, OutboundRow, VoidOutboundInput } from "./types";
import { requestClient } from "@/http";
import { idempotencyConfig } from "./idempotency";

export function fetchOutboundLedger(): Promise<OutboundRow[]> {
    return requestClient.get<OutboundRow[]>("/outbound");
}

export function createOutbound(input: CreateOutboundInput): Promise<OutboundRow> {
    return requestClient.post<OutboundRow>("/outbound", input, idempotencyConfig());
}

export function voidOutbound(no: string, input: VoidOutboundInput): Promise<OutboundRow> {
    return requestClient.post<OutboundRow>(`/outbound/${no}/void`, input, idempotencyConfig());
}

/** 删除已作废出库单（软删除）：响应恒为 data:null，列表刷新由 useWbMutation 失效驱动 */
export function deleteOutbound(no: string, input: DeleteOutboundInput): Promise<null> {
    return requestClient.post<null>(`/outbound/${no}/delete`, input, idempotencyConfig());
}
