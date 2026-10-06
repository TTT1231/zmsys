import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from "class-validator";
import { IsDateColumn } from "../../common/dto/is-date-column";

/** openapi UpdateOrderInput：expectedVersion 之外至少携带一个可变字段（service 层校验）。
 * 客户与 BOM 仅在订单净出库为 0 且无未删除出库单时可改（service 层守卫）；
 * orderDate 计入订单号不可改，不在可变字段内。null 归一为未提供（IsOptional 不拦 null） */
export class UpdateOrderDto {
    @IsInt()
    @Min(1, { message: "expectedVersion 须为正整数" })
    expectedVersion!: number;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : undefined))
    @IsOptional()
    @IsString()
    @Matches(/^CUS-[0-9]{4,}$/, { message: "客户编码格式须为 CUS-xxxx" })
    customerCode?: string;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : undefined))
    @IsOptional()
    @IsString()
    @MinLength(1, { message: "BOM 编码不能为空" })
    @MaxLength(32, { message: "BOM 编码最长 32 个字符" })
    bomCode?: string;

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
