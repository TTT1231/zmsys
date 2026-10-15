import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextField } from "@/components/ui/Field";
import { Icon } from "@/lib/icons";
import { PageHeading } from "@/components/ui/PageHeading";
import { PageLoading } from "@/components/ui/PageLoading";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/toastContexts";
import { fetchAiSettings, fetchAiUsage, testAiConnection, updateAiSettings } from "@/api";
import { num } from "@/lib/format";
import type { AiSettingsView } from "@/api";

const RANGE_OPTIONS = [
    { value: "today", label: "今天" },
    { value: "7d", label: "最近 7 天" },
    { value: "30d", label: "最近 30 天" },
    { value: "custom", label: "自定义" },
];

/** ISO 时刻截取到分钟（yyyy-MM-ddTHH:mm → yyyy-MM-dd HH:mm） */
const minuteOf = (iso: string): string => iso.slice(0, 16).replace("T", " ");

/** AI 工作台（menu:ai-workbench，默认仅超管）：上半服务配置、下半用量统计 */
export function AiWorkbenchPage() {
    const settings = useQuery({ queryKey: ["ai-settings"], queryFn: fetchAiSettings });

    return (
        <div className="flex w-full flex-col gap-6 p-5 lg:p-7">
            <PageHeading title="AI 工作台" description="AI 对话服务配置与用量统计" />
            {settings.isLoading ? (
                <PageLoading className="py-16" />
            ) : settings.isError ? (
                <section className="flex flex-col items-center gap-3 rounded-panel border border-line bg-surface px-6 py-12 text-center shadow-card">
                    <Icon name="alert" size={28} className="text-danger" />
                    <p className="text-14 text-td">配置加载失败：{settings.error?.message ?? "网络异常"}</p>
                    <Button variant="secondary" icon="refresh" onClick={() => void settings.refetch()}>
                        重试
                    </Button>
                </section>
            ) : settings.data ? (
                <SettingsCard settings={settings.data} />
            ) : null}
            <UsageCard />
        </div>
    );
}

/* ---------- 卡片一：服务配置 ---------- */

/** 配置表单：字段值本地初始化一次（保存后不回填覆盖输入），脱敏视图随查询刷新 */
function SettingsCard({ settings }: { settings: AiSettingsView }) {
    const toast = useToast();
    const queryClient = useQueryClient();
    const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
    const [apiKey, setApiKey] = useState("");
    const [model, setModel] = useState(settings.model);
    const [enabled, setEnabled] = useState(settings.enabled);
    const [validated, setValidated] = useState(false);

    // 首次配置（apiKeySet=false）必须填 key；baseUrl 非空时校验协议头
    const apiKeyError = validated && !settings.apiKeySet && !apiKey ? "首次配置必须填写 API Key" : "";
    const baseUrlError =
        validated && baseUrl.trim() !== "" && !/^https?:\/\//.test(baseUrl.trim())
            ? "服务地址须以 http:// 或 https:// 开头"
            : "";

    const saveMutation = useMutation({
        // 空字段省略（保持原值），apiKey 仅在有输入时上送；apiKey 空串是显式清除语义，不在表单触发
        mutationFn: () =>
            updateAiSettings({
                ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
                ...(apiKey ? { apiKey } : {}),
                ...(model.trim() ? { model: model.trim() } : {}),
                enabled,
            }),
        onSuccess: () => {
            setApiKey("");
            toast.success("已保存");
            void queryClient.invalidateQueries({ queryKey: ["ai-settings"] });
        },
        onError: (error: Error) => toast.error(error.message || "保存失败，请稍后重试"),
    });

    const testMutation = useMutation({
        mutationFn: testAiConnection,
        onSuccess: result => {
            if (result.ok) toast.success(`连通正常（${result.latencyMs}ms）`);
            else toast.error(result.message);
        },
        onError: (error: Error) => toast.error(error.message || "测试失败，请稍后重试"),
    });

    const save = () => {
        setValidated(true);
        if (apiKeyError || baseUrlError) return;
        saveMutation.mutate();
    };

    return (
        <section
            className="overflow-hidden rounded-panel border border-line bg-surface shadow-card"
            aria-labelledby="ai-settings-title"
        >
            <div className="border-b border-line px-5 py-4 sm:px-6">
                <h2 id="ai-settings-title" className="text-16 font-semibold text-ink">
                    服务配置
                </h2>
            </div>
            <div className="flex flex-col gap-4 p-5 sm:p-6">
                <div className="grid gap-4 md:grid-cols-2">
                    <TextField
                        label="服务地址"
                        placeholder="如 https://api.deepseek.com"
                        value={baseUrl}
                        onChange={event => setBaseUrl(event.target.value)}
                        error={baseUrlError}
                    />
                    <TextField
                        label="API Key"
                        type="password"
                        autoComplete="new-password"
                        placeholder="留空保持不变"
                        value={apiKey}
                        onChange={event => setApiKey(event.target.value)}
                        error={apiKeyError}
                        hint={settings.apiKeySet ? `当前：${settings.apiKeyMasked}` : "未配置"}
                    />
                    <TextField
                        label="模型"
                        placeholder="deepseek-flash（DeepSeek V4.1-Flash）"
                        value={model}
                        onChange={event => setModel(event.target.value)}
                    />
                    <Switch checked={enabled} onCheckedChange={setEnabled}>
                        启用
                    </Switch>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                    <Button disabled={saveMutation.isPending} aria-busy={saveMutation.isPending} onClick={save}>
                        {saveMutation.isPending ? "正在保存…" : "保存"}
                    </Button>
                    <Button variant="secondary" disabled={testMutation.isPending} onClick={() => testMutation.mutate()}>
                        {testMutation.isPending ? "测试中…" : "测试连接"}
                    </Button>
                </div>
                <p className="text-13 leading-5 text-muted">API Key 仅存服务端，页面不回显原文；清除请填空串保存</p>
            </div>
        </section>
    );
}

/* ---------- 卡片二：使用情况 ---------- */

function UsageCard() {
    // 默认最近 30 天；custom 草稿经「应用范围」生效（照系统日志页的时间范围处理）
    const [range, setRange] = useState<"today" | "7d" | "30d" | "custom">("30d");
    const [draftFrom, setDraftFrom] = useState("");
    const [draftTo, setDraftTo] = useState("");
    const [applied, setApplied] = useState<{ from: string; to: string } | null>(null);
    const [dateError, setDateError] = useState("");

    // 自定义范围未应用有效日期前不发起查询（缺 from/to 会被后端 400 拒绝）
    const pendingCustom = range === "custom" && !applied;
    const usage = useQuery({
        queryKey: ["ai-usage", range, range === "custom" ? applied : null],
        queryFn: () => fetchAiUsage({ range, from: applied?.from, to: applied?.to }),
        enabled: !pendingCustom,
    });
    const totals = usage.data?.totals;
    const users = usage.data?.users ?? [];
    const byDay = usage.data?.byDay ?? [];
    const maxDayTokens = byDay.reduce((max, day) => Math.max(max, day.totalTokens), 0);

    const applyCustomRange = () => {
        if (!draftFrom || !draftTo || draftFrom > draftTo) {
            setDateError("请选择完整日期，且开始日期不能晚于结束日期。");
            return;
        }
        setDateError("");
        setApplied({ from: draftFrom, to: draftTo });
    };

    return (
        <section
            className="overflow-hidden rounded-panel border border-line bg-surface shadow-card"
            aria-labelledby="ai-usage-title"
        >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
                <h2 id="ai-usage-title" className="text-16 font-semibold text-ink">
                    使用情况
                </h2>
                <select
                    value={range}
                    onChange={event => {
                        setRange(event.target.value as typeof range);
                        setDateError("");
                    }}
                    aria-label="时间范围"
                    className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-14 text-ink"
                >
                    {RANGE_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </div>
            {range === "custom" && (
                <div className="border-b border-line bg-soft/60 px-5 py-3">
                    <div className="grid items-end gap-2.5 md:grid-cols-[minmax(0,190px)_minmax(0,190px)_auto]">
                        <label className="flex flex-col gap-1 text-13 font-medium text-td">
                            开始日期
                            <input
                                type="date"
                                value={draftFrom}
                                onChange={event => setDraftFrom(event.target.value)}
                                aria-invalid={!!dateError && !draftFrom}
                                className="h-10 rounded-input border border-line-strong bg-surface px-2.5 text-14 text-ink"
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-13 font-medium text-td">
                            结束日期
                            <input
                                type="date"
                                value={draftTo}
                                onChange={event => setDraftTo(event.target.value)}
                                aria-invalid={!!dateError && !draftTo}
                                className="h-10 rounded-input border border-line-strong bg-surface px-2.5 text-14 text-ink"
                            />
                        </label>
                        <Button type="button" onClick={applyCustomRange}>
                            应用范围
                        </Button>
                        <p className="text-12 text-subtle md:col-span-3">包含起止日期。</p>
                        {dateError && (
                            <p role="alert" className="text-13 text-danger md:col-span-3">
                                {dateError}
                            </p>
                        )}
                    </div>
                </div>
            )}
            <div className="flex flex-col gap-5 p-5 sm:p-6">
                {pendingCustom ? (
                    <EmptyState description="请选择开始与结束日期，并点击「应用范围」后查看。" imageSize={120} />
                ) : usage.isLoading ? (
                    <PageLoading className="py-10" />
                ) : usage.isError ? (
                    <div className="flex flex-col items-center gap-3 py-8 text-center">
                        <Icon name="alert" size={28} className="text-danger" />
                        <p className="text-14 text-td">用量统计加载失败：{usage.error?.message ?? "网络异常"}</p>
                        <Button variant="secondary" icon="refresh" onClick={() => void usage.refetch()}>
                            重试
                        </Button>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                            <div className="rounded-card border border-line bg-panel px-4 py-3">
                                <span className="block text-12 text-muted">总请求</span>
                                <strong className="tnum text-20 font-bold text-ink">
                                    {num(totals?.requests ?? 0)}
                                </strong>
                                <span className="block text-12 text-subtle">
                                    成功 {num(totals?.successRequests ?? 0)} / 失败 {num(totals?.errorRequests ?? 0)}
                                </span>
                            </div>
                            {[
                                { label: "输入 tokens", value: totals?.promptTokens ?? 0 },
                                { label: "输出 tokens", value: totals?.completionTokens ?? 0 },
                                { label: "总 tokens", value: totals?.totalTokens ?? 0 },
                            ].map(stat => (
                                <div key={stat.label} className="rounded-card border border-line bg-panel px-4 py-3">
                                    <span className="block text-12 text-muted">{stat.label}</span>
                                    <strong className="tnum text-20 font-bold text-ink">{num(stat.value)}</strong>
                                </div>
                            ))}
                        </div>
                        <p className="text-12 text-muted">
                            仅汇总上游已返回的用量；缺失或部分未知的用量未完整计入，统计值可能低于实际消耗。
                        </p>
                        <div className="overflow-x-auto rounded-input border border-line">
                            <table className="data-table w-full min-w-[820px] text-13">
                                <thead>
                                    <tr className="text-left text-13 text-muted">
                                        <th>账号</th>
                                        <th>姓名</th>
                                        <th>角色</th>
                                        <th className="text-right">请求数</th>
                                        <th className="text-right">输入 tokens</th>
                                        <th className="text-right">输出 tokens</th>
                                        <th className="text-right">总 tokens</th>
                                        <th className="text-right">最近使用</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.length === 0 ? (
                                        <tr className="row-empty">
                                            <td colSpan={8} className="py-10 text-center text-14 text-muted">
                                                暂无使用记录
                                            </td>
                                        </tr>
                                    ) : (
                                        users.map(row => (
                                            <tr key={row.userId}>
                                                <td className="tnum whitespace-nowrap">{row.account}</td>
                                                <td className="whitespace-nowrap">{row.name}</td>
                                                <td>{row.role}</td>
                                                <td className="tnum text-right">{num(row.requests)}</td>
                                                <td className="tnum text-right">{num(row.promptTokens)}</td>
                                                <td className="tnum text-right">{num(row.completionTokens)}</td>
                                                <td className="tnum text-right">{num(row.totalTokens)}</td>
                                                <td className="tnum whitespace-nowrap text-right">
                                                    {row.lastUsedAt ? minuteOf(row.lastUsedAt) : "—"}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {byDay.length > 0 && (
                            <div className="flex flex-col gap-2">
                                <h3 className="text-14 font-semibold text-ink">按日趋势</h3>
                                {byDay.map(day => (
                                    <div key={day.date} className="flex items-center gap-3">
                                        <span className="tnum w-20 shrink-0 text-12 text-muted">{day.date}</span>
                                        <span className="h-4 min-w-0 flex-1 overflow-hidden rounded-sm bg-soft">
                                            <span
                                                className="block h-full rounded-sm bg-primary"
                                                style={{
                                                    width: `${
                                                        maxDayTokens > 0 ? (day.totalTokens / maxDayTokens) * 100 : 0
                                                    }%`,
                                                }}
                                            />
                                        </span>
                                        <span className="tnum w-20 shrink-0 text-right text-12 text-td">
                                            {num(day.totalTokens)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </section>
    );
}
