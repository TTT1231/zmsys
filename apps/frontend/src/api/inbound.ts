import type { CreateInboundInput, InboundRow } from "./types";
import { requestClient } from "@/http";

export function fetchInboundLedger(): Promise<InboundRow[]> {
    return requestClient.get<InboundRow[]>("/inbound");
}

export function createInbound(input: CreateInboundInput): Promise<InboundRow> {
    return requestClient.post<InboundRow>("/inbound", input);
}
