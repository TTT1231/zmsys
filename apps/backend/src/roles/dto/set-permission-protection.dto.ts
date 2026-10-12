import { Transform } from "class-transformer";
import { IsBoolean, IsOptional, IsString, Length } from "class-validator";

/** PATCH /permissions/catalog/:code/protected 入参（openapi SetPermissionProtectionInput） */
export class SetPermissionProtectionDto {
    /** true=加锁（默认仅超管）；false=解锁（可授予其他角色） */
    @IsBoolean()
    protected!: boolean;

    /** 变更原因，记入保护开关日志（服务端拼装展示文案） */
    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsOptional()
    @IsString()
    @Length(0, 500)
    reason?: string;
}
