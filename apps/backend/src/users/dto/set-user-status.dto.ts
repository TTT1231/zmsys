import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Length, Matches, Min } from 'class-validator';

/** openapi SetUserStatusInput；停用销售且仍负责客户时移交字段必填（服务端复核） */
export class SetUserStatusDto {
    @IsInt()
    @Min(1)
    expectedVersion!: number;

    @IsBoolean()
    active!: boolean;

    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsOptional()
    @Matches(/^[A-Za-z0-9_]{3,64}$/, { message: '接任账号为 3–64 位字母、数字或下划线' })
    replacementOwnerAccount?: string;

    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsOptional()
    @Length(2, 500, { message: '移交原因为 2–500 个字符' })
    transferReason?: string;
}
