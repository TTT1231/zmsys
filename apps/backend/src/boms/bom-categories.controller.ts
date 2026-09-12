import { Controller, Get } from '@nestjs/common';
import { BomsService } from './boms.service';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../constants';
import type { BomCategory } from './types';

/** BOM 品类目录（openapi boms tag）：前端不得自行决定有效品类、固定规格或编码前缀 */
@Controller('bom-categories')
export class BomCategoriesController {
    constructor(private readonly bomsService: BomsService) {}

    @Get()
    @Permissions([PERMISSIONS.BOM_VIEW], '无权查看 BOM 品类')
    async listCategories(): Promise<BomCategory[]> {
        return this.bomsService.listCategories();
    }
}
