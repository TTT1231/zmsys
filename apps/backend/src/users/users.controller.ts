import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Put } from "@nestjs/common";
import { UsersService } from "./users.service";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PERMISSIONS } from "../constants";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { SetUserStatusDto } from "./dto/set-user-status.dto";
import type { AuthUser } from "../common/types/auth-user";
import type { WbUser } from "../access-control/types";

/** 受保护端点：permissions:view / permissions:manage 仅 super 持有（契约 users tag） */
@Controller("users")
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    @Get()
    @Permissions([PERMISSIONS.PERMISSIONS_VIEW], "无权查看用户列表")
    async listUsers(): Promise<WbUser[]> {
        return this.usersService.listUsers();
    }

    @Post()
    @Permissions([PERMISSIONS.PERMISSIONS_MANAGE], "无权管理用户")
    @HttpCode(HttpStatus.OK) // openapi 契约为 200，覆盖 @Post 默认的 201
    async createUser(
        @Body() dto: CreateUserDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<WbUser> {
        return this.usersService.createUser(dto, actor, idempotencyKey);
    }

    @Put(":account")
    @Permissions([PERMISSIONS.PERMISSIONS_MANAGE], "无权管理用户")
    async updateUser(
        @Param("account") account: string,
        @Body() dto: UpdateUserDto,
        @CurrentUser() actor: AuthUser,
    ): Promise<WbUser> {
        return this.usersService.updateUser(account, dto, actor);
    }

    @Patch(":account/status")
    @Permissions([PERMISSIONS.PERMISSIONS_MANAGE], "无权管理用户")
    async setUserStatus(
        @Param("account") account: string,
        @Body() dto: SetUserStatusDto,
        @CurrentUser() actor: AuthUser,
    ): Promise<WbUser> {
        return this.usersService.setUserStatus(account, dto, actor);
    }
}
