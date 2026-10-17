/**
 * AI 工作台管理端点（契约 /ai/admin/*）：与菜单同码的受保护权限
 * menu:ai-workbench——默认仅超管；超管解锁下放并授权后，页面与 API 一致生效
 * （同备份/恢复模式，无「页面可见 API 403」的混合口径）。
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query } from "@nestjs/common";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PERMISSIONS } from "../constants";
import type { AuthUser } from "../common/types/auth-user";
import { AiAdminService } from "./ai-admin.service";
import { AiSettingsUpdateDto, AiUsageQueryDto } from "./dto/ai-admin.dto";

@Controller("ai/admin")
export class AiAdminController {
    constructor(private readonly adminService: AiAdminService) {}

    @Get("settings")
    @Permissions([PERMISSIONS.MENU_AI_WORKBENCH], "无权管理 AI 工作台")
    async getSettings() {
        return this.adminService.getSettings();
    }

    @Put("settings")
    @Permissions([PERMISSIONS.MENU_AI_WORKBENCH], "无权管理 AI 工作台")
    async updateSettings(@Body() dto: AiSettingsUpdateDto, @CurrentUser() actor: AuthUser) {
        return this.adminService.updateSettings(dto, actor);
    }

    @Post("test")
    @Permissions([PERMISSIONS.MENU_AI_WORKBENCH], "无权管理 AI 工作台")
    @HttpCode(HttpStatus.OK)
    async testConnection() {
        return this.adminService.testConnection();
    }

    @Get("balance")
    @Permissions([PERMISSIONS.MENU_AI_WORKBENCH], "无权管理 AI 工作台")
    async getBalance() {
        return this.adminService.getBalance();
    }

    @Get("usage")
    @Permissions([PERMISSIONS.MENU_AI_WORKBENCH], "无权管理 AI 工作台")
    async getUsage(@Query() query: AiUsageQueryDto) {
        return this.adminService.getUsage(query);
    }
}
