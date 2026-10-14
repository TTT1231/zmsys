import { Transform, Type } from "class-transformer";
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from "class-validator";
import { DraftItemDto, trim } from "./apply-structure.dto";

/**
 * 新建品类的草稿节点（平铺形态，与目录契约一致；tempId 关联多层父子与组内物料）。
 * SECTION 纯展示且只能为根；GROUP 挂品类根、分区或另一分组（parentTempId），
 * multi/qty 缺省按 false；分支可见层数含物料层 ≤5（校验器统一把关）。
 */
export class DraftNodeDto {
    @IsIn(["SECTION", "GROUP"])
    kind!: "SECTION" | "GROUP";

    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    tempId!: string;

    @Transform(trim)
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    name!: string;

    /** GROUP 专属：上级节点（分区/分组）tempId；null/省略 = 挂品类根 */
    @IsOptional()
    parentTempId?: string | null;

    @IsOptional()
    @IsBoolean()
    multi?: boolean;

    @IsOptional()
    @IsBoolean()
    qty?: boolean;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(200)
    @ValidateNested({ each: true })
    @Type(() => DraftItemDto)
    items?: DraftItemDto[];
}

/** 新建品类时一并创建的下属类型（目录容器品类）：类型即子品类，status=false、
 *  归属主品类的 child_categories；前缀仅防撞号（容器永不取号） */
export class CategoryTypeDto {
    @Transform(trim)
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    name!: string;

    @IsString()
    @Matches(/^[A-Z0-9]{1,16}$/, { message: "编码前缀为 1-16 位大写字母/数字" })
    codePrefix!: string;
}

/** POST /bom-structure/categories 请求体 */
export class CreateBomCategoryDto {
    @Transform(trim)
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    name!: string;

    @IsString()
    @Matches(/^[A-Z0-9]{1,16}$/, { message: "编码前缀为 1-16 位大写字母/数字" })
    codePrefix!: string;

    /** BOM 编码序号宽度（ck_bom_category_width：3-8），缺省 3 */
    @IsOptional()
    @IsInt()
    @Min(3)
    @Max(8)
    seqWidth?: number;

    /** 可选下属类型（最多 12 个）：创建后主品类为复合品类，建档时必选其一 */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(12)
    @ValidateNested({ each: true })
    @Type(() => CategoryTypeDto)
    types?: CategoryTypeDto[];

    @IsArray()
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => DraftNodeDto)
    groups!: DraftNodeDto[];
}
