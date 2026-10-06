import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

/** openapi UnarchiveOrderInput：回退备注选填（最长 500，留空存 NULL） */
export class UnarchiveOrderDto {
    @IsInt()
    @Min(1, { message: "expectedVersion 须为正整数" })
    expectedVersion!: number;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsOptional()
    @IsString()
    @MaxLength(500, { message: "回退备注最长 500 个字符" })
    reason?: string;
}
