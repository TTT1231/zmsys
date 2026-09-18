import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { IsDateColumn } from "../../common/dto/is-date-column";

/** openapi UpdateOrderInput：expectedVersion 之外至少携带一个可变字段（service 层校验） */
export class UpdateOrderDto {
    @IsInt()
    @Min(1, { message: "expectedVersion 须为正整数" })
    expectedVersion!: number;

    @IsOptional()
    @IsInt()
    @Min(1, { message: "数量必须为不小于 1 的整数" })
    qty?: number;

    @IsOptional()
    @IsDateColumn("交货日期")
    deliverDate?: string;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsOptional()
    @IsString()
    @MaxLength(2000, { message: "备注最长 2000 个字符" })
    remark?: string;
}
