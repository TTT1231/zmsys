import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** openapi PrintOutboundInput：首次打印 reason 可空；重打至少 2 字（按单头状态在 service 分支校验） */
export class PrintOutboundDto {
    @IsInt()
    @Min(1)
    expectedVersion!: number;

    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsOptional()
    @IsString()
    @MaxLength(500, { message: '打印原因最长 500 个字符' })
    reason?: string;
}
