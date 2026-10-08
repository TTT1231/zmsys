import { Transform } from "class-transformer";
import { IsArray, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { IsDateColumn } from "../common/dto/is-date-column";
import type { RelationStatus, RelationType } from "./relations.types";

export const RELATION_TYPE_KEYS: RelationType[] = ["bom", "customer", "order", "inbound", "outbound", "person"];

export class RelationsQueryDto {
    @IsOptional()
    @IsIn(["open", "completed", "archived", "all"])
    status: RelationStatus = "open";

    @IsOptional()
    @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? (value ? value.split(",") : []) : value))
    @IsArray()
    @IsIn(RELATION_TYPE_KEYS, { each: true })
    types: RelationType[] = [...RELATION_TYPE_KEYS];

    @IsOptional()
    @IsString()
    @MaxLength(24)
    orderNo?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    bomCode?: string;

    @IsOptional()
    @IsString()
    @MaxLength(24)
    customerCode?: string;

    @IsOptional()
    @IsDateColumn("开始日期")
    start?: string;

    @IsOptional()
    @IsDateColumn("结束日期")
    end?: string;
}
