import type {
    CreateOutboundInput,
    EmergencyVoidOutboundInput,
    OutboundPrintResult,
    OutboundRow,
    PrintOutboundInput,
    VoidOutboundInput,
} from "./types";
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

export function printOutboundDocument(no: string, input: PrintOutboundInput): Promise<OutboundPrintResult> {
    return requestClient.post<OutboundPrintResult>(`/outbound/${no}/print`, input, idempotencyConfig());
}

export function emergencyVoidOutbound(no: string, input: EmergencyVoidOutboundInput): Promise<OutboundRow> {
    return requestClient.post<OutboundRow>(`/outbound/${no}/emergency-void`, input, idempotencyConfig());
}
