import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, Length, Matches, MaxLength, Min } from "class-validator";

/** openapi UpdateCustomerInput：phone 传空串表示保留原号码（响应只回掩码，改号须提交完整 11 位） */
export class UpdateCustomerDto {
    @IsInt()
    @Min(1, { message: "expectedVersion 须为正整数" })
    expectedVersion!: number;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @Length(4, 80, { message: "客户名称为 4–80 个字符" })
    name!: string;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @Length(1, 32, { message: "联系人为 1–32 个字符" })
    contact!: string;

    /** 空串 = 不修改；非空须为完整 11 位 */
    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @Matches(/^(|1[0-9]{10})$/, { message: "手机号须为 11 位数字或空串（空串表示不修改）" })
    phone!: string;

    /** 省市可空；空串规范化为 NULL（db-scheme.md §1.1 无值统一 NULL） */
    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsOptional()
    @IsString()
    @MaxLength(64, { message: "省份最长 64 个字符" })
    province?: string;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsOptional()
    @IsString()
    @MaxLength(64, { message: "城市最长 64 个字符" })
    city?: string;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsOptional()
    @IsString()
    @MaxLength(64, { message: "县区最长 64 个字符" })
    district?: string;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsOptional()
    @IsString()
    @MaxLength(96, { message: "乡镇最长 96 个字符" })
    town?: string;

    /** 地址可空；空串规范化为 NULL（db-scheme.md §1.1 无值统一 NULL） */
    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsOptional()
    @IsString()
    @MaxLength(300, { message: "详细地址最长 300 个字符" })
    address?: string;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @Length(1, 64, { message: "负责人账号不能为空" })
    ownerAccount!: string;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @MaxLength(160, { message: "付款条件最长 160 个字符" })
    payTerms!: string;
}
