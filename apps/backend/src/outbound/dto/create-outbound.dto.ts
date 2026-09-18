import { Transform } from "class-transformer";
import { IsInt, IsString, MaxLength, Min } from "class-validator";
import { IsDateColumn } from "../../common/dto/is-date-column";

/** openapi CreateOutboundInput：客户/BOM 信息由订单快照派生，不接受客户端提交 */
export class CreateOutboundDto {
    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @MaxLength(32, { message: "订单号最长 32 个字符" })
    orderNo!: string;

    @IsInt()
    @Min(1, { message: "请输入有效的发货数量" })
    qty!: number;

    @IsDateColumn("出库日期")
    date!: string;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @MaxLength(500, { message: "备注最长 500 个字符" })
    remark!: string;
}
