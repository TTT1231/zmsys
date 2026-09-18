import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Min } from "class-validator";
import { ROLE_CODES } from "../../constants";

/** openapi UpdateUserInput；account 由路径定位且不可改 */
export class UpdateUserDto {
    @IsInt()
    @Min(1)
    expectedVersion!: number;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @Length(1, 20, { message: "姓名为 1–20 个字符" })
    name!: string;

    @IsIn([...ROLE_CODES], { message: "未知角色" })
    role!: (typeof ROLE_CODES)[number];

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsOptional()
    @Matches(/^[A-Za-z0-9_]{3,64}$/, { message: "接任账号为 3–64 位字母、数字或下划线" })
    replacementOwnerAccount?: string;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsOptional()
    @Length(2, 500, { message: "移交原因为 2–500 个字符" })
    transferReason?: string;
}
