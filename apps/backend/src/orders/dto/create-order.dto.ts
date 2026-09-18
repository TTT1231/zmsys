import { Transform } from "class-transformer";
import { IsInt, IsString, Matches, MaxLength, Min } from "class-validator";
import { IsDateColumn } from "../../common/dto/is-date-column";

/** openapi CreateOrderInput：客户与 BOM 名称/规格快照由服务端查询，不接受客户端提交 */
export class CreateOrderDto {
    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @Matches(/^CUS-[0-9]{4,}$/, { message: "客户编码格式须为 CUS-xxxx" })
    customerCode!: string;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @MaxLength(32, { message: "BOM 编码最长 32 个字符" })
    bomCode!: string;

    @IsInt()
    @Min(1, { message: "数量必须为不小于 1 的整数" })
    qty!: number;

    /** 业务日期（下单日，参与订单号日序号）与交货日期均为真实日历日 */
    @IsDateColumn("下单日期")
    orderDate!: string;

    @IsDateColumn("交货日期")
    deliverDate!: string;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @MaxLength(2000, { message: "备注最长 2000 个字符" })
    remark!: string;
}
