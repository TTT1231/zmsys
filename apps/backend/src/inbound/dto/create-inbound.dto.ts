import { Transform } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';
import { IsDateColumn } from '../../common/dto/is-date-column';

/** openapi CreateInboundInput：登记人与登记时间取服务端鉴权上下文，不接受客户端提交 */
export class CreateInboundDto {
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @MaxLength(32, { message: 'BOM 编码最长 32 个字符' })
    bomCode!: string;

    @IsInt()
    @Min(1, { message: '请输入有效的入库数量' })
    qty!: number;

    /** 业务日期（补录历史日期允许；仅修正窗口按 created_at 北京日判定） */
    @IsDateColumn('入库日期')
    date!: string;

    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @MaxLength(500, { message: '备注最长 500 个字符' })
    remark!: string;
}
