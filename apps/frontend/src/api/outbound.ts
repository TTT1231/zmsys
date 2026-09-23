import type { CreateOutboundInput, OutboundPrintDocument, OutboundRow, VoidOutboundInput } from "./types";
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

/** 打印文档为纯读输出：任意状态可打、可重复，无需幂等头 */
export function printOutboundDocument(no: string): Promise<OutboundPrintDocument> {
    return requestClient.get<OutboundPrintDocument>(`/outbound/${no}/print`);
}
