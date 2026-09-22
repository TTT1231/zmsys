import { Controller, Get, Param } from "@nestjs/common";
import { BomsService } from "./boms.service";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PERMISSIONS } from "../constants";
import type { BomStockLedger } from "./types";

/** BOM 库存余量聚合（openapi boms tag）：bomCode → 当前余量，口径同 v_bom_stock */
@Controller("bom-stocks")
export class BomStocksController {
    constructor(private readonly bomsService: BomsService) {}

    @Get()
    @Permissions([PERMISSIONS.BOM_VIEW], "无权查看 BOM 库存")
    async listStocks(): Promise<Record<string, number>> {
        return this.bomsService.listStocks();
    }

    @Get(":code/ledger")
    @Permissions([PERMISSIONS.BOM_VIEW], "无权查看 BOM 库存")
    async stockLedger(@Param("code") code: string): Promise<BomStockLedger> {
        return this.bomsService.stockLedger(code);
    }
}
