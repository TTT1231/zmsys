import { Controller, Get } from '@nestjs/common';
import { UsersService } from './users.service';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../constants';
import type { CustomerOwnerOption } from './types';

/**
 * 客户负责人候选（openapi tag 归 customers，权限 customers:view）。
 * 当前由用户管理的离岗移交弹窗消费，先落在 users 模块；
 * customers 模块落地后如需扩充再整体迁移。
 */
@Controller('customer-owner-options')
export class OwnerOptionsController {
    constructor(private readonly usersService: UsersService) {}

    @Get()
    @Permissions([PERMISSIONS.CUSTOMERS_VIEW], '无权查看负责人候选')
    async listOwnerOptions(): Promise<CustomerOwnerOption[]> {
        return this.usersService.listSalesOwnerOptions();
    }
}
