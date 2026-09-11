import type { Bom, BomCategory, CreateBomInput } from "./types";
import { requestClient } from "@/http";
import { idempotencyConfig } from "./idempotency";

export function fetchBoms(): Promise<Bom[]> {
    return requestClient.get<Bom[]>("/boms");
}

export function fetchBomCategories(): Promise<BomCategory[]> {
    return requestClient.get<BomCategory[]>("/bom-categories");
}

export function createBom(input: CreateBomInput): Promise<Bom> {
    return requestClient.post<Bom>("/boms", input, idempotencyConfig());
}
