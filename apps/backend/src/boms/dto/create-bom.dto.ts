import { Transform } from 'class-transformer';
import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';

/** openapi CreateBomInput：品类名匹配后端目录；编码与固定规格由服务端决定 */
export class CreateBomDto {
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @IsNotEmpty({ message: '请选择品类' })
    name!: string;

    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @IsNotEmpty({ message: '请输入型号' })
    @MaxLength(64, { message: '型号最多 64 个字符' })
    modelCode!: string;

    /** 值必须为字符串的校验在 service（自由键无法用嵌套 DTO 表达） */
    @IsObject({ message: '规格必须是对象' })
    specs!: Record<string, unknown>;
}
