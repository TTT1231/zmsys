import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Length, Matches, Max, Min, ValidateIf } from "class-validator";
import { IsDateColumn } from "../../common/dto/is-date-column";
import type { DeletedDomain } from "../types";

/** 关键词限定可打印 ASCII：target_code 为 ascii_bin 列，非 ASCII 子串直接 LIKE 会触发
 *  排序规则冲突报错（500）；中文检索走 /system-logs（其 keyword 经 CONVERT 支持） */
const ASCII_KEYWORD = /^[!-~]+$/;

/** 已删除数据查询（GET /ai/agent/deleted，契约 system-logs:view）：
 *  数据源为 op_log 的 delete_* 快照——2026-10 起单据删除均为物理删除，快照是唯一留存。
 *  分批与 /system-logs 同款 (occurredAt, id) 复合游标（加载更多语义，非翻页）。 */
export class AgentDeletedQueryDto {
    /** 业务域筛选；缺省全部 */
    @IsOptional()
    @IsIn(["customer", "order", "bom", "bom_structure", "inbound", "outbound"])
    domain?: DeletedDomain;

    /** 关键词 LIKE：匹配目标编号（订单号/单号/编码；可打印 ASCII 子串） */
    @IsOptional()
    @Type(() => String)
    @Length(1, 64)
    @Matches(ASCII_KEYWORD, { message: "keyword 须为可打印 ASCII（编号检索）" })
    keyword?: string;

    /** 时间范围：今天 / 最近 7 天 / 最近 30 天（均含今天，北京日界）/ 自定义；缺省 30d */
    @IsOptional()
    @IsIn(["today", "7d", "30d", "custom"])
    range: "today" | "7d" | "30d" | "custom" = "30d";

    /** 自定义范围起止（range=custom 必填；包含起止日期，北京日界） */
    @IsOptional()
    @ValidateIf(o => o.range === "custom")
    @IsDateColumn("开始日期")
    from?: string;

    @IsOptional()
    @ValidateIf(o => o.range === "custom")
    @IsDateColumn("结束日期")
    to?: string;

    /** 每批条数 1–100，默认 50 */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit: number = 50;

    /** 游标：上一批末条 occurredAt（ISO 时刻） */
    @IsOptional()
    @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, { message: "beforeAt 须为 ISO 时刻" })
    beforeAt?: string;

    /** 游标：上一批末条雪花 id（十进制数字串；BigInt 精度，绝不能 Number 解析） */
    @IsOptional()
    @Matches(/^[0-9]+$/, { message: "beforeId 须为十进制数字串" })
    beforeId?: string;
}
