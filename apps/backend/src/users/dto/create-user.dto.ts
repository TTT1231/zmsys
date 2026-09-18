import { Transform } from 'class-transformer';
import { IsIn, IsString, Length, Matches } from 'class-validator';
import { CREATE_ROLE_CODES } from '../../constants';

/** openapi CreateUserInput；初始密码固定 123456（强哈希落库），不由客户端提交 */
export class CreateUserDto {
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @Length(1, 20, { message: '姓名为 1–20 个字符' })
    name!: string;

    /** 账号唯一且创建后不可修改，与 openapi Account 参数同 pattern */
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @Matches(/^[A-Za-z0-9_]{3,64}$/, {
        message: '账号为 3–64 位字母、数字或下划线',
    })
    account!: string;

    @IsIn([...CREATE_ROLE_CODES], { message: '不得通过接口新增超级管理员' })
    role!: (typeof CREATE_ROLE_CODES)[number];
}
