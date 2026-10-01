import { IsInt, Min } from "class-validator";

/** openapi DeleteXxxInput 共用：删除按乐观锁校验版本，其余条件由服务端数据判定 */
export class ExpectedVersionDto {
    @IsInt()
    @Min(1, { message: "expectedVersion 须为正整数" })
    expectedVersion!: number;
}
