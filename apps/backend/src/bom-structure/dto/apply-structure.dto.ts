import { Type, Transform } from "class-transformer";
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    MaxLength,
    Min,
    ValidateNested,
} from "class-validator";

export const trim = ({ value }: { value: unknown }): unknown => (typeof value === "string" ? value.trim() : value);

/** 草稿物料（随 add_group/新建品类草稿携带）；tempId 为前端生成的一次性标识 */
export class DraftItemDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    tempId!: string;

    @Transform(trim)
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    name!: string;
}

/**
 * 单个结构操作。语义类型是 catalog-projector 的 StructureOperation（七态
 * discriminated union）；class-validator 对多态嵌套校验支持有限，这里用一个
 * 宽松类声明全部字段，按 type 的必填约束由服务层 normalizeOperations 收口
 * （缺字段返回 400，与未知字段拒绝的管线口径一致）。
 */
export class StructureOperationDto {
    @IsIn(["add_section", "add_group", "add_item", "hide", "restore", "reorder", "set_rules"])
    type!: string;

    /** 新增节点/物料的草稿标识（同批唯一，供后续操作引用） */
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    tempId?: string;

    @IsOptional()
    @Transform(trim)
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    name?: string;

    /** add_group 专属：null/省略 = 挂品类根；否则为已存分区 id 或同批草稿分区 tempId */
    @IsOptional()
    parentId?: string | null;

    /** add_item/set_rules 专属：已存分组 id 或同批草稿分组 tempId */
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    groupId?: string;

    @IsOptional()
    @IsBoolean()
    multi?: boolean;

    @IsOptional()
    @IsBoolean()
    qty?: boolean;

    /** add_group 专属：标记为型号组（groupKey=model，品类内至多一个） */
    @IsOptional()
    @IsBoolean()
    isModel?: boolean;

    @IsOptional()
    @IsIn(["section", "group", "item"])
    targetType?: string;

    /** hide/restore/reorder 专属：已存节点/物料 id 或同批草稿 tempId */
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    targetId?: string;

    @IsOptional()
    @IsIn(["up", "down"])
    direction?: string;

    /** add_group 专属：随组新建的物料 */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(200)
    @ValidateNested({ each: true })
    @Type(() => DraftItemDto)
    items?: DraftItemDto[];
}

/** POST /bom-structure/apply 请求体 */
export class ApplyBomStructureDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(40)
    categoryKey!: string;

    /** 期望的品类目录版本（乐观锁）：与本品类当前 row_version 不一致即 409 */
    @IsInt()
    @Min(1)
    expectedRowVersion!: number;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(200, { message: "单次最多 200 个结构操作" })
    @ValidateNested({ each: true })
    @Type(() => StructureOperationDto)
    operations!: StructureOperationDto[];
}
