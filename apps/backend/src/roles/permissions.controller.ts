import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { PERMISSIONS } from "../constants";
import { Permissions } from "../common/decorators/permissions.decorator";
import { SuperOnly } from "../common/decorators/super-only.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types/auth-user";
import { PermissionCatalogService } from "./permission-catalog.service";
import { SetPermissionProtectionDto } from "./dto/set-permission-protection.dto";
import type { PermissionCatalogEntry, ProtectionLogEntry } from "./types";

/**
 * 权限目录与保护开关：读走 permissions:view（super 直通；解锁后持码角色同权可读），
 * 切换保护状态仅 @SuperOnly——永不挂权限码，防止借解锁后的权限码自我提权。
 */
@Controller("permissions")
export class PermissionsController {
    constructor(private readonly catalog: PermissionCatalogService) {}

    @Get("catalog")
    @Permissions([PERMISSIONS.PERMISSIONS_VIEW], "无权查看权限目录")
    async listCatalog(): Promise<PermissionCatalogEntry[]> {
        return this.catalog.listCatalog();
    }

    @Get("catalog/log")
    @Permissions([PERMISSIONS.PERMISSIONS_VIEW], "无权查看保护开关日志")
    async listProtectionLogs(): Promise<ProtectionLogEntry[]> {
        return this.catalog.listChangeLogs();
    }

    @Patch("catalog/:code/protected")
    @SuperOnly("仅超级管理员可调整受保护权限")
    async setProtection(
        @Param("code") code: string,
        @Body() dto: SetPermissionProtectionDto,
        @CurrentUser() actor: AuthUser,
    ): Promise<PermissionCatalogEntry> {
        return this.catalog.setProtection(code, dto, actor);
    }
}
