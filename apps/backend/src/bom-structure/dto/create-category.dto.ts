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
 * 新建品类的草稿节点（平铺形态，与目录契约一致；tempId 关联分区父子与组内物料）。
 * SECTION 纯展示；GROUP 挂根或分区（parentTempId），multi/qty 缺省按 false。
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

    /** GROUP 专属：所属分区 tempId；null/省略 = 挂品类根 */
    @IsOptional()
    parentTempId?: string | null;

    @IsOptional()
    @IsBoolean()
    multi?: boolean;

    @IsOptional()
    @IsBoolean()
    qty?: boolean;

    /** 型号组标记（groupKey=model，品类内至多一个） */
    @IsOptional()
    @IsBoolean()
    isModel?: boolean;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(200)
    @ValidateNested({ each: true })
    @Type(() => DraftItemDto)
    items?: DraftItemDto[];
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

    @IsArray()
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => DraftNodeDto)
    groups!: DraftNodeDto[];
}
