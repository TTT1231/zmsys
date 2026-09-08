import type { SystemEvent } from "./types";
import { requestClient } from "@/http";

export function fetchSystemEvents(): Promise<SystemEvent[]> {
    return requestClient.get<SystemEvent[]>("/system-events");
}
