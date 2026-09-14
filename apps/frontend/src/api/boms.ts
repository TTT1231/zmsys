import type { Bom, BomCategory, BomStockMap, CreateBomInput } from "./types";
import { requestClient } from "@/http";
import { idempotencyConfig } from "./idempotency";

export function fetchBoms(): Promise<Bom[]> {
    return requestClient.get<Bom[]>("/boms");
}

export function fetchBomCategories(): Promise<BomCategory[]> {
    return requestClient.get<BomCategory[]>("/bom-categories");
}

/** BOM 维度余量聚合（口径同 v_bom_stock），供列表页库存列使用，避免拉全量台账推导 */
export function fetchBomStocks(): Promise<BomStockMap> {
    return requestClient.get<BomStockMap>("/bom-stocks");
}

export function createBom(input: CreateBomInput): Promise<Bom> {
    return requestClient.post<Bom>("/boms", input, idempotencyConfig());
}
