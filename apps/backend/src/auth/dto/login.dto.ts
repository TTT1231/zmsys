import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export class LoginDto {
    /** 账号列区分大小写，登录按 trim 后的原值精确匹配 */
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @Matches(/^[A-Za-z0-9_]{3,64}$/, {
        message: '账号为 3–64 位字母、数字或下划线',
    })
    account!: string;

    @IsString()
    @Length(1, 128, { message: '请输入密码' })
    password!: string;
}
