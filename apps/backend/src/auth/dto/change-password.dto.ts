import { IsString, Length } from "class-validator";

export class ChangePasswordDto {
    @IsString()
    @Length(1, 128, { message: "请输入旧密码" })
    oldPassword!: string;

    @IsString()
    @Length(6, 128, { message: "新密码至少 6 位" })
    newPassword!: string;
}
