import type { Bom, CreateBomInput } from "./types";
import { requestClient } from "@/http";

export function fetchBoms(): Promise<Bom[]> {
    return requestClient.get<Bom[]>("/boms");
}

export function createBom(input: CreateBomInput): Promise<Bom> {
    return requestClient.post<Bom>("/boms", input);
}
