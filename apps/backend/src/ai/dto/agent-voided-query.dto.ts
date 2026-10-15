import { Type } from "class-transformer";
import { IsInt, IsOptional, Length, Matches, Max, Min } from "class-validator";

/** 关键词限定可打印 ASCII（编号/单号本身即 ascii_bin 列，非 ASCII 子串直接 LIKE 会触发
 *  排序规则冲突报错——同列中文检索须 CONVERT，见 system-logs.service 先例；agent 文档
 *  明示 keyword 匹配编号，中文姓名/名称走 /system-logs 的 operator/keyword 通道） */
const ASCII_KEYWORD = /^[!-~]+$/;

/** 作废入库查询（GET /ai/agent/voided/inbound，契约 inbound:view） */
export class VoidedInboundQueryDto {
    /** BOM 编号精确匹配 */
    @IsOptional()
    @Type(() => String)
    @Length(1, 32)
    bomCode?: string;

    /** 关键词 LIKE：匹配入库单号或 BOM 编号（可打印 ASCII 子串） */
    @IsOptional()
    @Type(() => String)
    @Length(1, 64)
    @Matches(ASCII_KEYWORD, { message: "keyword 须为可打印 ASCII（编号/单号检索）" })
    keyword?: string;

    /** 返回条数 1–200，默认 100；total 会一并返回，超过上限时用筛选收敛 */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(200)
    limit: number = 100;
}

/** 作废出库查询（GET /ai/agent/voided/outbound，契约 outbound:view） */
export class VoidedOutboundQueryDto {
    /** 订单号精确匹配 */
    @IsOptional()
    @Type(() => String)
    @Length(1, 24)
    orderNo?: string;

    /** BOM 编号精确匹配 */
    @IsOptional()
    @Type(() => String)
    @Length(1, 32)
    bomCode?: string;

    /** 关键词 LIKE：匹配出库单号或订单号（可打印 ASCII 子串） */
    @IsOptional()
    @Type(() => String)
    @Length(1, 64)
    @Matches(ASCII_KEYWORD, { message: "keyword 须为可打印 ASCII（编号/单号检索）" })
    keyword?: string;

    /** 返回条数 1–200，默认 100；total 会一并返回，超过上限时用筛选收敛 */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(200)
    limit: number = 100;
}
