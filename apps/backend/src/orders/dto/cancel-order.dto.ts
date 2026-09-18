import { Transform } from "class-transformer";
import { IsInt, IsString, Length, Min } from "class-validator";

/** openapi CancelOrderInput：取消必须填写原因（数据库 CHECK 2–500 字符） */
export class CancelOrderDto {
    @IsInt()
    @Min(1, { message: "expectedVersion 须为正整数" })
    expectedVersion!: number;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @Length(2, 500, { message: "取消原因为 2–500 个字符" })
    reason!: string;
}
