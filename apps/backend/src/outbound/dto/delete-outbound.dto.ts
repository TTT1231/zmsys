import { IsInt, Min } from "class-validator";

/** openapi DeleteOutboundInput：删除按乐观锁校验版本，仅已作废单可删由服务端数据判定 */
export class DeleteOutboundDto {
    @IsInt()
    @Min(1, { message: "expectedVersion 须为正整数" })
    expectedVersion!: number;
}
