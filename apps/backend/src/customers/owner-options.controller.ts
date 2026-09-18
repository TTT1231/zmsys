import { Controller, Get } from "@nestjs/common";
import { CustomersService } from "./customers.service";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PERMISSIONS } from "../constants";
import type { CustomerOwnerOption } from "./types";

/** 客户负责人候选（openapi customers tag）：仅返回启用中销售与超级管理员的展示字段 */
@Controller("customer-owner-options")
export class OwnerOptionsController {
    constructor(private readonly customersService: CustomersService) {}

    @Get()
    @Permissions([PERMISSIONS.CUSTOMERS_VIEW], "无权查看负责人候选")
    async listOwnerOptions(): Promise<CustomerOwnerOption[]> {
        return this.customersService.listOwnerOptions();
    }
}
