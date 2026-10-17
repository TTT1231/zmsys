import { BadGatewayException, BadRequestException, HttpException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SnowflakeGenerator } from "../common/snowflake";
import { beijingDayWindow } from "../common/beijing-day";
import type { AuthUser } from "../common/types/auth-user";
import { recordOpLog } from "../domain/op-log";
import { DEFAULT_AI_MODEL } from "./ai-docs-topics";
import { estimateCostCny } from "./pricing";
import type { AiSettingsUpdateDto, AiUsageQueryDto } from "./dto/ai-admin.dto";
import type { AiBalanceInfo, AiSettingsView, AiTestResult, AiUsageSummary, AiUsageUserRow } from "./types";
import { balanceUrl, chatCompletionsUrl, readUpstreamError, upstreamFailureMessage } from "./upstream";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 连通测试超时（诊断场景，不等对话级 45s） */
const TEST_TIMEOUT_MS = 15_000;
/** 余额查询超时（轻量 GET，不给对话级预算） */
const BALANCE_TIMEOUT_MS = 10_000;

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
 * 配置读写（api_key 只存服务端、读接口脱敏、空串显式清除）、连通测试、账户余额
 * 查询（上游 /user/balance 转发）、按人用量聚合（按模型单价折算金额）。
 * 配置变更与业务行同事务写 op_log(update_ai_config) 审计（脱敏快照，
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

    /** 账户余额（上游 /user/balance 转发；未保存配置与连通测试同口径 400，上游异常 502） */
    async getBalance(): Promise<AiBalanceInfo> {
        const row = await this.prisma.aiProviderConfig.findUnique({ where: { id: 1 } });
        if (!row || !row.baseUrl || !row.apiKey) {
            throw new BadRequestException("请先保存服务地址与 API Key，再查询余额");
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), BALANCE_TIMEOUT_MS);
        try {
            const response = await fetch(balanceUrl(row.baseUrl), {
                headers: { authorization: `Bearer ${row.apiKey}` },
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new BadGatewayException(await readUpstreamError(response));
            }
            const payload = (await response.json()) as {
                is_available?: boolean;
                balance_infos?: Array<{
                    currency?: string;
                    total_balance?: string;
                    granted_balance?: string;
                    topped_up_balance?: string;
                }>;
            };
            const info = payload.balance_infos?.find(item => item.currency === "CNY") ?? payload.balance_infos?.[0];
            if (!info) {
                throw new BadGatewayException("AI 上游未返回余额信息");
            }
            const toNumber = (value: string | undefined): number => {
                const parsed = Number.parseFloat(value ?? "");
                return Number.isFinite(parsed) ? parsed : 0;
            };
            return {
                isAvailable: payload.is_available ?? true,
                currency: info.currency ?? "CNY",
                totalBalance: toNumber(info.total_balance),
                grantedBalance: toNumber(info.granted_balance),
                toppedUpBalance: toNumber(info.topped_up_balance),
            };
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new BadGatewayException(upstreamFailureMessage(error));
        } finally {
            clearTimeout(timer);
        }
    }

    /** 按人聚合用量并按模型单价折算金额（估算口径见 pricing.ts；金额降序） */
    async getUsage(query: AiUsageQueryDto): Promise<AiUsageSummary> {
        const window = this.usageWindow(query);
        // model 进分组键：不同模型单价不同，按行折算后再累计
        const grouped = await this.prisma.aiUsageLog.groupBy({
            by: ["userId", "model"],
            _sum: { promptTokens: true, completionTokens: true },
            _max: { createdAt: true },
            where: { createdAt: { gte: window.start, lt: window.end } },
        });
        interface UserAcc {
            amount: number;
            lastUsedAt: Date | null;
        }
        const byUser = new Map<bigint, UserAcc>();
        for (const row of grouped) {
            const acc = byUser.get(row.userId) ?? { amount: 0, lastUsedAt: null };
            acc.amount += estimateCostCny(row.model, row._sum.promptTokens ?? 0, row._sum.completionTokens ?? 0);
            const last = row._max.createdAt;
            if (last && (!acc.lastUsedAt || last > acc.lastUsedAt)) {
                acc.lastUsedAt = last;
            }
            byUser.set(row.userId, acc);
        }
        const users = await this.prisma.sysUser.findMany({
            where: { id: { in: [...byUser.keys()] } },
            select: { id: true, account: true, name: true },
        });
        const roundCny = (value: number): number => Math.round(value * 1e4) / 1e4;
        const userRows: AiUsageUserRow[] = users
            .map(user => {
                const acc = byUser.get(user.id)!;
                return {
                    userId: user.id.toString(),
                    account: user.account,
                    name: user.name,
                    amount: roundCny(acc.amount),
                    lastUsedAt: acc.lastUsedAt?.toISOString() ?? null,
                };
            })
            .sort((a, b) => b.amount - a.amount);
        return {
            from: window.start.toISOString(),
            to: window.end.toISOString(),
            totals: { amount: roundCny(userRows.reduce((sum, row) => sum + row.amount, 0)) },
            users: userRows,
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
