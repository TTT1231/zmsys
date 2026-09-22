import { IsInt, Min } from "class-validator";

/** openapi ResetUserPasswordInput；重置为初始密码并递增 token_version 吊销旧会话 */
export class ResetUserPasswordDto {
    @IsInt()
    @Min(1)
    expectedVersion!: number;
}
