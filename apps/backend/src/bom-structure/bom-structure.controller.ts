import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { BomStructureService } from "./bom-structure.service";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PERMISSIONS } from "../constants";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types/auth-user";
import { ApplyBomStructureDto } from "./dto/apply-structure.dto";
import { CreateBomCategoryDto } from "./dto/create-category.dto";
import type { BomStructureApplyResult, BomStructureCategoryCreated } from "./types";

/**
 * BOM 结构在线维护（openapi bom-structure tag，db-scheme.md §5.4）：仅超级管理员
 * （受保护权限 bom-structure:manage）。生效口径：结构变更只影响保存后新建的 BOM，
 * 已保存 BOM 及关联订单、出入库记录不会自动补充或修改——旧 BOM 需要增加物料时
 * 请另建 BOM。读取复用 GET /bom-categories（bom:view，目录全量含停用标记）。
 */
@Controller("bom-structure")
export class BomStructureController {
    constructor(private readonly bomStructureService: BomStructureService) {}

    @Post("apply")
    @Permissions([PERMISSIONS.BOM_STRUCTURE_MANAGE], "只有超级管理员可以维护 BOM 结构")
    @HttpCode(HttpStatus.OK)
    async apply(
        @Body() dto: ApplyBomStructureDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<BomStructureApplyResult> {
        return this.bomStructureService.apply(dto, actor, idempotencyKey);
    }

    @Post("categories")
    @Permissions([PERMISSIONS.BOM_STRUCTURE_MANAGE], "只有超级管理员可以新建 BOM 品类")
    @HttpCode(HttpStatus.OK)
    async createCategory(
        @Body() dto: CreateBomCategoryDto,
        @CurrentUser() actor: AuthUser,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
    ): Promise<BomStructureCategoryCreated> {
        return this.bomStructureService.createCategory(dto, actor, idempotencyKey);
    }
}
