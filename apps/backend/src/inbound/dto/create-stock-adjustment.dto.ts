import { Transform } from "class-transformer";
import { IsInt, NotEquals, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { IsDateColumn } from "../../common/dto/is-date-column";

/** openapi CreateStockAdjustmentInput：跨日库存调整只追加、不可改删 */
export class CreateStockAdjustmentDto {
    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @MaxLength(32, { message: "BOM 编码最长 32 个字符" })
    bomCode!: string;

    /** 非零有符号整数（正负皆可），0 由本 DTO 校验拦截 */
    @IsInt()
    @NotEquals(0, { message: "调整数量不能为 0" })
    qtyDelta!: number;

    @IsDateColumn("调整日期")
    date!: string;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @MinLength(2, { message: "请填写调整原因（至少 2 个字）" })
    @MaxLength(500, { message: "调整原因最长 500 个字符" })
    reason!: string;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsOptional()
    @IsString()
    @MaxLength(28, { message: "关联入库单号最长 28 个字符" })
    relatedInboundNo?: string;
}
