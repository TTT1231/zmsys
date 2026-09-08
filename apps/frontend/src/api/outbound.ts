import type { CreateOutboundInput, OutboundRow } from "./types";
import { requestClient } from "@/http";

export function fetchOutboundLedger(): Promise<OutboundRow[]> {
    return requestClient.get<OutboundRow[]>("/outbound");
}

export function createOutbound(input: CreateOutboundInput): Promise<OutboundRow> {
    return requestClient.post<OutboundRow>("/outbound", input);
}
