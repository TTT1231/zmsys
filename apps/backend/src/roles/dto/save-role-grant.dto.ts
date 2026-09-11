import { Transform, Type } from 'class-transformer';
import { IsArray, IsInt, IsObject, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';

/** 与 openapi RoleGrant 对应；version 字段仅回显用途，保存以 expectedVersion 为准 */
export class RoleGrantDto {
    @IsInt()
    @Min(1)
    version!: number;

    @Transform(({ value }) => (Array.isArray(value) ? value.map(item => String(item)) : value))
    @IsArray()
    @IsString({ each: true })
    menus!: string[];

    @IsObject()
    actions!: Record<string, string[]>;
}

export class SaveRoleGrantDto {
    @ValidateNested()
    @Type(() => RoleGrantDto)
    grant!: RoleGrantDto;

    @IsInt()
    @Min(1)
    expectedVersion!: number;

    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsOptional()
    @IsString()
    @Length(0, 500)
    note?: string;
}
