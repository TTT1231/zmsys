import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../constants';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import type { AuthUser } from '../common/types/auth-user';
import type { Customer } from './types';

/** 客户档案（openapi customers tag）：客户不可删除，编辑走 PUT /customers/:code */
@Controller('customers')
export class CustomersController {
    constructor(private readonly customersService: CustomersService) {}

    @Get()
    @Permissions([PERMISSIONS.CUSTOMERS_VIEW], '无权查看客户列表')
    async listCustomers(): Promise<Customer[]> {
        return this.customersService.listCustomers();
    }

    @Post()
    @Permissions([PERMISSIONS.CUSTOMERS_CREATE], '无权新建客户')
    @HttpCode(HttpStatus.OK) // openapi 契约为 200，覆盖 @Post 默认的 201
    async createCustomer(
        @Body() dto: CreateCustomerDto,
        @CurrentUser() actor: AuthUser,
        @Headers('idempotency-key') idempotencyKey: string | undefined,
    ): Promise<Customer> {
        return this.customersService.createCustomer(dto, actor, idempotencyKey);
    }

    @Put(':code')
    @Permissions([PERMISSIONS.CUSTOMERS_EDIT], '无权编辑客户')
    async updateCustomer(
        @Param('code') code: string,
        @Body() dto: UpdateCustomerDto,
        @CurrentUser() actor: AuthUser,
    ): Promise<Customer> {
        return this.customersService.updateCustomer(code, dto, actor);
    }
}
