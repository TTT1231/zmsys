import { Transform } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

/** openapi VoidResourceInput：出库作废（版本 + 原因） */
export class VoidOutboundDto {
    @IsInt()
    @Min(1)
    expectedVersion!: number;

    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @MinLength(2, { message: '请填写作废原因（至少 2 个字）' })
    @MaxLength(500, { message: '作废原因最长 500 个字符' })
    reason!: string;
}
