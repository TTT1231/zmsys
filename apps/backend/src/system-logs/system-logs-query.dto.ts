import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Length, Matches, Max, Min, ValidateIf } from "class-validator";
import { IsDateColumn } from "../common/dto/is-date-column";
import type { SystemLogAction, SystemLogDomain } from "./types";

/** 系统日志查询参数（GET /system-logs）：筛选 + 复合游标（加载更多语义，非翻页） */
export class SystemLogsQueryDto {
    /** 业务域筛选；缺省全部 */
    @IsOptional()
    @IsIn(["customer", "order", "bom", "inbound", "outbound"])
    domain?: SystemLogDomain;

    /** 操作类型筛选；缺省全部 */
    @IsOptional()
    @IsIn(["create", "edit", "transfer", "archive", "unarchive", "delete", "void", "ship", "adjust"])
    action?: SystemLogAction;

    /** 时间范围：今天 / 最近 7 天 / 最近 30 天（均含今天，北京日界）/ 自定义 */
    @IsOptional()
    @IsIn(["today", "7d", "30d", "custom"])
    range: "today" | "7d" | "30d" | "custom" = "today";

    /** 自定义范围起止（range=custom 必填；包含起止日期，北京日界） */
    @IsOptional()
    @ValidateIf(o => o.range === "custom")
    @IsDateColumn("开始日期")
    from?: string;

    @IsOptional()
    @ValidateIf(o => o.range === "custom")
    @IsDateColumn("结束日期")
    to?: string;

    /** 关键词 LIKE：匹配操作人姓名、目标编号、目标名称三项 */
    @IsOptional()
    @Type(() => String)
    @Length(1, 64)
    keyword?: string;

    /** 每批条数 1–100，默认 20 */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit: number = 20;

    /** 游标：上一批末条 occurredAt（ISO 时刻） */
    @IsOptional()
    @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, { message: "beforeAt 须为 ISO 时刻" })
    beforeAt?: string;

    /** 游标：上一批末条来源行雪花 id（十进制数字串；BigInt 精度，绝不能 Number 解析） */
    @IsOptional()
    @Matches(/^[0-9]+$/, { message: "beforeId 须为十进制数字串" })
    beforeId?: string;
}
