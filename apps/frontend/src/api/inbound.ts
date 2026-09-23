import type {
    CreateInboundInput,
    CreateStockAdjustmentInput,
    DeleteInboundInput,
    InboundRow,
    StockAdjustmentRow,
    UpdateInboundInput,
    VoidInboundInput,
} from "./types";
import { requestClient } from "@/http";
import { idempotencyConfig } from "./idempotency";

export function fetchInboundLedger(): Promise<InboundRow[]> {
    return requestClient.get<InboundRow[]>("/inbound");
}

export function createInbound(input: CreateInboundInput): Promise<InboundRow> {
    return requestClient.post<InboundRow>("/inbound", input, idempotencyConfig());
}

export function updateInbound(no: string, input: UpdateInboundInput): Promise<InboundRow> {
    return requestClient.put<InboundRow>(`/inbound/${no}`, input);
}

export function voidInbound(no: string, input: VoidInboundInput): Promise<InboundRow> {
    return requestClient.post<InboundRow>(`/inbound/${no}/void`, input, idempotencyConfig());
}

/** 删除已作废入库（软删除）：响应恒为 data:null，列表刷新由 useWbMutation 失效驱动 */
export function deleteInbound(no: string, input: DeleteInboundInput): Promise<null> {
    return requestClient.post<null>(`/inbound/${no}/delete`, input, idempotencyConfig());
}

export function fetchStockAdjustments(): Promise<StockAdjustmentRow[]> {
    return requestClient.get<StockAdjustmentRow[]>("/stock-adjustments");
}

export function createStockAdjustment(input: CreateStockAdjustmentInput): Promise<StockAdjustmentRow> {
    return requestClient.post<StockAdjustmentRow>("/stock-adjustments", input, idempotencyConfig());
}
