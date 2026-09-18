import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { RolesService } from "./roles.service";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PERMISSIONS } from "../constants";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { SaveRoleGrantDto } from "./dto/save-role-grant.dto";
import type { AuthUser } from "../common/types/auth-user";
import type { GrantLogEntry, GrantMap, RoleDef, RoleGrant } from "./types";

@Controller("roles")
export class RolesController {
    constructor(private readonly rolesService: RolesService) {}

    @Get()
    @Permissions([PERMISSIONS.PERMISSIONS_VIEW], "无权查看角色")
    async listRoles(): Promise<RoleDef[]> {
        return this.rolesService.listRoles();
    }

    @Get("grants")
    @Permissions([PERMISSIONS.PERMISSIONS_VIEW], "无权查看角色授权")
    async listGrants(): Promise<GrantMap> {
        return this.rolesService.getGrantMap();
    }

    @Get("grants/log")
    @Permissions([PERMISSIONS.PERMISSIONS_VIEW], "无权查看授权日志")
    async listGrantLogs(): Promise<GrantLogEntry[]> {
        return this.rolesService.listGrantLogs();
    }

    @Put(":roleId/grants")
    @Permissions([PERMISSIONS.PERMISSIONS_MANAGE], "无权修改角色授权")
    async updateRoleGrant(
        @Param("roleId") roleId: string,
        @Body() dto: SaveRoleGrantDto,
        @CurrentUser() actor: AuthUser,
    ): Promise<RoleGrant> {
        return this.rolesService.saveGrant(roleId, dto, actor);
    }
}
