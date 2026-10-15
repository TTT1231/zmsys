import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SnowflakeGenerator } from "../common/snowflake";
import { beijingDayWindow } from "../common/beijing-day";
import type { AuthUser } from "../common/types/auth-user";
import { recordOpLog } from "../domain/op-log";
import { DEFAULT_AI_MODEL } from "./ai-docs-topics";
import type { AiSettingsUpdateDto, AiUsageQueryDto } from "./dto/ai-admin.dto";
import type { AiSettingsView, AiTestResult, AiUsageDayRow, AiUsageSummary, AiUsageUserRow } from "./types";
import { chatCompletionsUrl, readUpstreamError, upstreamFailureMessage } from "./upstream";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 连通测试超时（诊断场景，不等对话级 45s） */
const TEST_TIMEOUT_MS = 15_000;

/** api_key 脱敏：只透出首尾各若干位；短 key 全遮蔽 */
const maskApiKey = (key: string): string => (key.length <= 8 ? "••••" : `${key.slice(0, 3)}••••${key.slice(-4)}`);

interface AiProviderConfigRow {
    baseUrl: string;
    apiKey: string;
    model: string;
    enabled: boolean;
    updatedAt: Date;
    updater: { name: string } | null;
}

/**
 * AI 工作台管理（契约 /ai/admin/*，受保护权限 menu:ai-workbench，默认仅超管）：
 * 配置读写（api_key 只存服务端、读接口脱敏、空串显式清除）、连通测试、按人/按日
 * 用量聚合。配置变更与业务行同事务写 op_log(update_ai_config) 审计（脱敏快照，
 * 绝不写入 key 内容；系统审计动作，不进系统日志时间线）。
 */
@Injectable()
export class AiAdminService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly snowflake: SnowflakeGenerator,
    ) {}

    async getSettings(): Promise<AiSettingsView> {
        const row = await this.prisma.aiProviderConfig.findUnique({
            where: { id: 1 },
            include: { updater: { select: { name: true } } },
        });
        return this.toView(row);
    }

    async updateSettings(dto: AiSettingsUpdateDto, actor: AuthUser): Promise<AiSettingsView> {
        const now = new Date();
        await this.prisma.$transaction(async tx => {
            const existing = await tx.aiProviderConfig.findUnique({ where: { id: 1 } });
            let baseUrl: string;
            let model: string;
            let enabled: boolean;
            const fields: string[] = [];
            if (!existing) {
                if (dto.baseUrl === undefined || dto.apiKey === undefined) {
                    throw new BadRequestException("首次配置必须填写服务地址与 API Key");
                }
                baseUrl = dto.baseUrl;
                model = dto.model ?? DEFAULT_AI_MODEL;
                enabled = dto.enabled ?? false;
                await tx.aiProviderConfig.create({
                    data: {
                        id: 1,
                        baseUrl,
                        apiKey: dto.apiKey,
                        model,
                        enabled,
                        updatedBy: BigInt(actor.id),
                        createdAt: now,
                        updatedAt: now,
                    },
                });
                fields.push(
                    ...(["baseUrl", "apiKey"] as const),
                    ...(dto.model ? ["model" as const] : []),
                    ...(dto.enabled !== undefined ? ["enabled" as const] : []),
                );
            } else {
                baseUrl = dto.baseUrl ?? existing.baseUrl;
                model = dto.model ?? existing.model;
                enabled = dto.enabled ?? existing.enabled;
                if (dto.baseUrl !== undefined && dto.baseUrl !== existing.baseUrl) {
                    fields.push("baseUrl");
                }
                if (dto.model !== undefined && dto.model !== existing.model) {
                    fields.push("model");
                }
                if (dto.enabled !== undefined && dto.enabled !== existing.enabled) {
                    fields.push("enabled");
                }
                const apiKey = dto.apiKey === undefined ? existing.apiKey : dto.apiKey;
                if (dto.apiKey !== undefined) {
                    // 空串 = 显式清除
                    fields.push("apiKey");
                }
                await tx.aiProviderConfig.update({
                    where: { id: 1 },
                    data: {
                        ...(dto.baseUrl !== undefined ? { baseUrl: dto.baseUrl } : {}),
                        ...(dto.model !== undefined ? { model: dto.model } : {}),
                        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
                        ...(dto.apiKey !== undefined ? { apiKey } : {}),
                        updatedBy: BigInt(actor.id),
                        updatedAt: now,
                    },
                });
            }
            // 审计快照脱敏：只记变更字段名与变更后形态（不含 key 内容）
            await recordOpLog(tx, this.snowflake, actor, {
                action: "update_ai_config",
                targetType: "ai_config",
                targetId: 1n,
                targetCode: "ai-provider-config",
                detail: {
                    fields,
                    apiKeyChanged: !existing ? true : dto.apiKey !== undefined,
                    enabled,
                    baseUrlHost: hostOf(baseUrl),
                    model,
                },
                now,
            });
        });
        return this.getSettings();
    }

    /** 连通测试：max_tokens=1 的最小补全（诊断不记账，不占用对话用量统计） */
    async testConnection(): Promise<AiTestResult> {
        const row = await this.prisma.aiProviderConfig.findUnique({ where: { id: 1 } });
        if (!row || !row.baseUrl || !row.apiKey) {
            throw new BadRequestException("请先保存服务地址与 API Key，再测试连通性");
        }
        const model = row.model || DEFAULT_AI_MODEL;
        const startedAt = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
        try {
            const response = await fetch(chatCompletionsUrl(row.baseUrl), {
                method: "POST",
                headers: {
                    authorization: `Bearer ${row.apiKey}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    model,
                    messages: [{ role: "user", content: "ping" }],
                    max_tokens: 1,
                    stream: false,
                }),
                signal: controller.signal,
            });
            const latencyMs = Date.now() - startedAt;
            if (!response.ok) {
                return { ok: false, latencyMs, message: await readUpstreamError(response), model };
            }
            return { ok: true, latencyMs, message: `连通正常（${latencyMs}ms）`, model };
        } catch (error) {
            return {
                ok: false,
                latencyMs: Date.now() - startedAt,
                message: upstreamFailureMessage(error),
                model,
            };
        } finally {
            clearTimeout(timer);
        }
    }

    /** 按人聚合 + 汇总 + 按日（北京日界） */
    async getUsage(query: AiUsageQueryDto): Promise<AiUsageSummary> {
        const window = this.usageWindow(query);
        const grouped = await this.prisma.aiUsageLog.groupBy({
            by: ["userId", "status"],
            _count: { _all: true },
            _sum: { promptTokens: true, completionTokens: true, totalTokens: true },
            _max: { createdAt: true },
            where: { createdAt: { gte: window.start, lt: window.end } },
        });
        interface UserAcc {
            requests: number;
            successRequests: number;
            errorRequests: number;
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
            lastUsedAt: Date | null;
        }
        const byUser = new Map<bigint, UserAcc>();
        for (const row of grouped) {
            const acc = byUser.get(row.userId) ?? {
                requests: 0,
                successRequests: 0,
                errorRequests: 0,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                lastUsedAt: null,
            };
            acc.requests += row._count._all;
            if (row.status === "success") {
                acc.successRequests += row._count._all;
            } else {
                acc.errorRequests += row._count._all;
            }
            acc.promptTokens += row._sum.promptTokens ?? 0;
            acc.completionTokens += row._sum.completionTokens ?? 0;
            acc.totalTokens += row._sum.totalTokens ?? 0;
            const last = row._max.createdAt;
            if (last && (!acc.lastUsedAt || last > acc.lastUsedAt)) {
                acc.lastUsedAt = last;
            }
            byUser.set(row.userId, acc);
        }
        const users = await this.prisma.sysUser.findMany({
            where: { id: { in: [...byUser.keys()] } },
            select: { id: true, account: true, name: true, roleCode: true },
        });
        const userRows: AiUsageUserRow[] = users
            .map(user => {
                const acc = byUser.get(user.id)!;
                return {
                    userId: user.id.toString(),
                    account: user.account,
                    name: user.name,
                    role: user.roleCode,
                    requests: acc.requests,
                    promptTokens: acc.promptTokens,
                    completionTokens: acc.completionTokens,
                    totalTokens: acc.totalTokens,
                    lastUsedAt: acc.lastUsedAt?.toISOString() ?? null,
                };
            })
            .sort((a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests);
        // 按日聚合（北京日）：DATE_FORMAT + CONVERT_TZ 偏移式换算（不依赖时区表）
        const dayRows = await this.prisma.$queryRaw<Array<{ day: string; requests: bigint; totalTokens: bigint }>>`
            SELECT DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+08:00'), '%Y-%m-%d') AS day,
                   COUNT(*) AS requests,
                   COALESCE(SUM(total_tokens), 0) AS totalTokens
            FROM ai_usage_log
            WHERE created_at >= ${window.start} AND created_at < ${window.end}
            GROUP BY day
            ORDER BY day
        `;
        const byDay: AiUsageDayRow[] = dayRows.map(row => ({
            date: row.day,
            requests: Number(row.requests),
            totalTokens: Number(row.totalTokens),
        }));
        return {
            from: window.start.toISOString(),
            to: window.end.toISOString(),
            totals: {
                requests: userRows.reduce((sum, row) => sum + row.requests, 0),
                successRequests: [...byUser.values()].reduce((sum, acc) => sum + acc.successRequests, 0),
                errorRequests: [...byUser.values()].reduce((sum, acc) => sum + acc.errorRequests, 0),
                promptTokens: userRows.reduce((sum, row) => sum + row.promptTokens, 0),
                completionTokens: userRows.reduce((sum, row) => sum + row.completionTokens, 0),
                totalTokens: userRows.reduce((sum, row) => sum + row.totalTokens, 0),
            },
            users: userRows,
            byDay,
        };
    }

    private toView(row: AiProviderConfigRow | null): AiSettingsView {
        if (!row) {
            return {
                baseUrl: "",
                model: DEFAULT_AI_MODEL,
                enabled: false,
                apiKeySet: false,
                apiKeyMasked: null,
                updatedAt: null,
                updatedByName: null,
            };
        }
        return {
            baseUrl: row.baseUrl,
            model: row.model,
            enabled: row.enabled,
            apiKeySet: Boolean(row.apiKey),
            apiKeyMasked: row.apiKey ? maskApiKey(row.apiKey) : null,
            updatedAt: row.updatedAt.toISOString(),
            updatedByName: row.updater?.name ?? null,
        };
    }

    /** 时间范围 → [start, end) UTC 时刻（北京日界；口径与系统日志一致） */
    private usageWindow(query: AiUsageQueryDto): { start: Date; end: Date } {
        const { start, nextStart } = beijingDayWindow();
        if (query.range === "custom") {
            if (!query.from || !query.to) {
                throw new BadRequestException("自定义范围必须填写开始与结束日期");
            }
            if (query.from > query.to) {
                throw new BadRequestException("开始日期不能晚于结束日期");
            }
            const fromWindow = beijingDayWindow(new Date(`${query.from}T00:00:00.000+08:00`));
            const toWindow = beijingDayWindow(new Date(`${query.to}T00:00:00.000+08:00`));
            return { start: fromWindow.start, end: toWindow.nextStart };
        }
        const days = query.range === "7d" ? 7 : query.range === "30d" ? 30 : 1;
        return { start: new Date(start.getTime() - (days - 1) * DAY_MS), end: nextStart };
    }
}

const hostOf = (baseUrl: string): string => {
    try {
        return new URL(baseUrl).host;
    } catch {
        return baseUrl;
    }
};
