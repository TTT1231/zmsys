import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsOptional, IsUrl, Length, ValidateIf } from "class-validator";
import { IsDateColumn } from "../../common/dto/is-date-column";

/** PUT /ai/admin/settings（受保护权限 menu:ai-workbench）：部分更新——
 *  省略的字段保持原值；apiKey 空串 = 显式清除；首次配置必须给 baseUrl + apiKey。 */
export class AiSettingsUpdateDto {
    /** OpenAI 兼容上游的服务地址（如 https://api.deepseek.com） */
    @IsOptional()
    @IsUrl({ protocols: ["http", "https"], require_tld: false })
    @Length(1, 255)
    baseUrl?: string;

    /** 空串 = 清除已存 key；非空则为设置/轮换（8–512 字符） */
    @IsOptional()
    @Length(0, 512)
    apiKey?: string;

    @IsOptional()
    @Length(1, 64)
    model?: string;

    @IsOptional()
    @IsBoolean()
    enabled?: boolean;
}

/** GET /ai/admin/usage 的时间范围（口径与系统日志一致：北京日界，含今天） */
export class AiUsageQueryDto {
    @IsOptional()
    @IsIn(["today", "7d", "30d", "custom"])
    range: "today" | "7d" | "30d" | "custom" = "30d";

    @IsOptional()
    @ValidateIf(o => o.range === "custom")
    @IsDateColumn("开始日期")
    @Type(() => String)
    from?: string;

    @IsOptional()
    @ValidateIf(o => o.range === "custom")
    @IsDateColumn("结束日期")
    @Type(() => String)
    to?: string;
}
