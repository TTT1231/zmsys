import { Module } from "@nestjs/common";
import { RolesService } from "./roles.service";
import { RolesController } from "./roles.controller";
import { PermissionCatalogService } from "./permission-catalog.service";
import { PermissionsController } from "./permissions.controller";

@Module({
    providers: [RolesService, PermissionCatalogService],
    controllers: [RolesController, PermissionsController],
})
export class RolesModule {}
