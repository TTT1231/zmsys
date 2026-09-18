import { Transform } from "class-transformer";
import { IsInt, IsString, MaxLength, Min, MinLength } from "class-validator";
import { IsDateColumn } from "../../common/dto/is-date-column";

/** openapi UpdateInboundInput：当天修正可改 BOM、数量、业务日期与备注；原登记人和时间不变 */
export class UpdateInboundDto {
    @IsInt()
    @Min(1)
    expectedVersion!: number;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @MaxLength(32, { message: "BOM 编码最长 32 个字符" })
    bomCode!: string;

    @IsInt()
    @Min(1, { message: "请输入有效的入库数量" })
    qty!: number;

    @IsDateColumn("入库日期")
    date!: string;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @MaxLength(500, { message: "备注最长 500 个字符" })
    remark!: string;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @MinLength(2, { message: "请填写修正原因（至少 2 个字）" })
    @MaxLength(500, { message: "修正原因最长 500 个字符" })
    reason!: string;
}
