import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Icon } from "@/lib/icons";
import { Button } from "@/components/ui/Badge";
import { PageHeading } from "@/components/ui/PageHeading";
import { fetchRestoreJobByKey, previewRestore, runRestore } from "@/api";
import { useToast } from "@/components/ui/toastContexts";
import { useApp } from "@/context/useApp";
import { isApiError } from "@/http/errors";
import type { BackupPreviewResult, RestoreJob, RestoreMode } from "@/api";

/** localStorage 持久化的待核实提交（刷新/断线/401 后凭同一 key 继续） */
interface PendingSubmission {
    requestKey: string;
    fileName: string;
    mode: RestoreMode;
    submittedAt: string;
}

const PENDING_KEY = "zmsys-restore-pending";

const loadPending = (): PendingSubmission | null => {
    try {
        const raw = localStorage.getItem(PENDING_KEY);
        return raw ? (JSON.parse(raw) as PendingSubmission) : null;
    } catch {
        return null;
    }
};

const TERMINAL: ReadonlySet<string> = new Set(["SUCCEEDED", "SUCCEEDED_AUDIT_FAILED", "FAILED"]);

const newRequestKey = (): string => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
};

/** 数据库恢复（仅超管）：选文件 → 预检 → 模式与确认口令 → 提交后轮询凭证 */
export function RestorePage() {
    const { can } = useApp();
    const toast = useToast();
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<BackupPreviewResult | null>(null);
    const [mode, setMode] = useState<RestoreMode>("merge");
    const [ack, setAck] = useState("");
    const [pending, setPending] = useState<PendingSubmission | null>(() => loadPending());
    const [job, setJob] = useState<RestoreJob | null>(null);
    const [notFound, setNotFound] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollTimer = useRef<number | null>(null);

    useEffect(() => {
        if (pending) {
            localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
        } else {
            localStorage.removeItem(PENDING_KEY);
        }
    }, [pending]);

    const previewMutation = useMutation({
        mutationFn: (target: File) => previewRestore(target),
        onSuccess: result => {
            setPreview(result);
            setAck("");
            if (!result.canReplace && mode === "replace") {
                setMode("merge");
            }
        },
        onError: (error: Error) => {
            setPreview(null);
            toast(error.message || "预检失败：文件不合法或与当前库结构不符", true);
        },
    });

    const clearSubmission = useCallback(() => {
        setPending(null);
        setJob(null);
        setNotFound(false);
        localStorage.removeItem(PENDING_KEY);
    }, []);

    const submitMutation = useMutation({
        mutationFn: async (input: { file: File; mode: RestoreMode; ack: string }) => {
            // 发请求前【同步】持久化 requestKey：effect 异步写入存在刷新丢 key 的窗口
            const requestKey = pending?.requestKey ?? newRequestKey();
            const record: PendingSubmission = {
                requestKey,
                fileName: input.file.name,
                mode: input.mode,
                submittedAt: new Date().toISOString(),
            };
            localStorage.setItem(PENDING_KEY, JSON.stringify(record));
            setPending(record);
            return runRestore({ file: input.file, mode: input.mode, ack: input.ack, requestKey });
        },
        onSuccess: outcome => {
            if (
                outcome.status === "SUCCEEDED" ||
                outcome.status === "SUCCEEDED_AUDIT_FAILED" ||
                outcome.status === "FAILED"
            ) {
                // 同 key 重提：服务端回放原终态
                if (outcome.job) setJob(outcome.job);
                return;
            }
            toast("恢复任务已受理，执行期间系统进入维护态");
        },
        onError: (error: Error) => {
            // 确定性拒绝（400 预检/409 冲突/413 超限/404 路由）：回提交表单纠错重试；
            // 网络错误/超时/-1 保留原 key 继续轮询（结果不明不得换 key）
            const code = isApiError(error) ? error.code : -1;
            if (code === 400 || code === 409 || code === 413 || code === 404) {
                clearSubmission();
                toast(error.message || "提交被拒绝，请调整后重试", true);
                return;
            }
            toast(error.message || "提交失败（requestKey 已保留，可稍后重查）", true);
        },
    });

    /** 轮询：401（replace 抬升 token_version / 会话过期）不判作恢复失败，重登录后自动继续 */
    const pollJob = useCallback(
        async (requestKey: string) => {
            try {
                const current = await fetchRestoreJobByKey(requestKey);
                setJob(current);
                setNotFound(false);
                if (TERMINAL.has(current.status)) {
                    // 终态只释放持久化 key（允许后续新 key 新提交），保留结果展示，
                    // 由用户点击「完成」清理界面
                    localStorage.removeItem(PENDING_KEY);
                    if (pollTimer.current !== null) {
                        window.clearInterval(pollTimer.current);
                        pollTimer.current = null;
                    }
                }
            } catch (error) {
                const status =
                    (error as { status?: number; code?: number }).status ?? (error as { code?: number }).code;
                if (status === 404) {
                    // 当前未查到记录 ≠ 终态：原请求可能仍在上传或预检，保留 key 继续查询
                    setNotFound(true);
                    return;
                }
                if (status === 401) {
                    // 会话失效（如 replace 后 token_version 抬升）：全局拦截器已引导重登录，
                    // 重登录回到本页后凭持久化 key 自动继续轮询
                    return;
                }
                // 网络错误等：保留 key，下一轮继续
            }
        },
        [clearSubmission],
    );

    useEffect(() => {
        if (!pending || pollTimer.current !== null) return;
        void pollJob(pending.requestKey);
        pollTimer.current = window.setInterval(() => {
            const current = loadPending();
            if (current) {
                void pollJob(current.requestKey);
            }
        }, 2000);
        return () => {
            if (pollTimer.current !== null) {
                window.clearInterval(pollTimer.current);
                pollTimer.current = null;
            }
        };
    }, [pending, pollJob]);

    if (!can("system-restore:run")) {
        return <div className="p-6 text-14 text-subtle">仅超级管理员可访问数据库恢复。</div>;
    }

    // —— 已有待核实提交：优先展示任务进度，不展示提交表单 ——
    if (pending) {
        const statusText: Record<string, string> = {
            RUNNING: "执行中（系统维护态）",
            UNKNOWN: "提交结果核实中",
            SUCCEEDED: "成功",
            SUCCEEDED_AUDIT_FAILED: "成功（审计补记失败，见服务日志）",
            FAILED: "失败（已回滚）",
        };
        return (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-5 lg:p-7">
                <PageHeading
                    eyebrow="系统"
                    title="数据库恢复"
                    description={`requestKey：${pending.requestKey}（请留存，断线/重登录后凭它继续查询）`}
                />
                <section className="rounded-card border border-line bg-panel p-5">
                    <div className="flex items-center gap-3">
                        {(job?.status ?? "RUNNING") === "RUNNING" || job?.status === "UNKNOWN" ? (
                            <Icon name="refresh" size={18} className="animate-spin text-primary" />
                        ) : (
                            <Icon
                                name={job?.status === "FAILED" ? "alert" : "check"}
                                size={18}
                                className={job?.status === "FAILED" ? "text-danger" : "text-success"}
                            />
                        )}
                        <div className="min-w-0 flex-1">
                            <div className="text-15 font-semibold text-ink">
                                {statusText[job?.status ?? "RUNNING"] ?? job?.status ?? "执行中"}
                            </div>
                            <div className="mt-0.5 text-12 text-subtle">
                                {pending.fileName} · {pending.mode === "merge" ? "合并补缺" : "整库快照还原"}
                                {job?.finishedAt && ` · 完成于 ${new Date(job.finishedAt).toLocaleString()}`}
                            </div>
                        </div>
                    </div>
                    {notFound && (
                        <div className="mt-3 rounded-xl bg-soft px-3.5 py-2.5 text-13 leading-5 text-td">
                            当前未查到该 key 的持久记录（原请求可能仍在上传或预检，不代表终态）。 可稍候继续查询，或以
                            <b>同一文件 / 同一模式 / 同一 requestKey</b> 重新提交。
                            {file && (
                                <span className="mt-2 flex flex-wrap gap-2">
                                    <Button
                                        className="min-h-8 px-3 text-13"
                                        disabled={submitMutation.isPending}
                                        onClick={() =>
                                            submitMutation.mutate({
                                                file,
                                                mode: pending.mode,
                                                ack: pending.mode === "merge" ? "RESTORE" : "REPLACE",
                                            })
                                        }
                                    >
                                        重新提交（{pending.fileName}）
                                    </Button>
                                    <Button className="min-h-8 px-3 text-13" onClick={clearSubmission}>
                                        放弃本次提交
                                    </Button>
                                </span>
                            )}
                        </div>
                    )}
                    {job?.status === "FAILED" && job.errorText && (
                        <div className="mt-3 rounded-xl bg-danger-soft px-3.5 py-2.5 text-13 leading-5 text-danger-strong">
                            {job.errorText}
                        </div>
                    )}
                    {job?.report?.tables && job.status !== "FAILED" && (
                        <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-line">
                            <table className="w-full text-13">
                                <thead>
                                    <tr className="border-b border-line bg-soft text-left text-12 text-subtle">
                                        <th className="px-3 py-2 font-medium">表</th>
                                        <th className="px-3 py-2 font-medium">插入</th>
                                        <th className="px-3 py-2 font-medium">跳过（一致）</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {job.report.tables.map(table => (
                                        <tr
                                            key={table.name}
                                            className="border-b border-dashed border-line last:border-b-0"
                                        >
                                            <td className="px-3 py-1.5 text-td">{table.name}</td>
                                            <td className="px-3 py-1.5 text-td">{table.inserted}</td>
                                            <td className="px-3 py-1.5 text-td">{table.skipped}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {(job?.status === "SUCCEEDED" || job?.status === "SUCCEEDED_AUDIT_FAILED") &&
                        pending.mode === "replace" && (
                            <div className="mt-3 rounded-xl bg-warning-soft/60 px-3.5 py-2.5 text-13 leading-5 text-warning-strong">
                                整库还原已提交：所有用户会话已失效，请重新登录。
                                {job?.report?.tokenVersionsRaised
                                    ? `共抬升 ${job.report.tokenVersionsRaised} 个账号的会话版本。`
                                    : ""}
                            </div>
                        )}
                    {job && TERMINAL.has(job.status) && (
                        <div className="mt-4 flex justify-end">
                            <Button className="min-h-9 px-4 text-14" onClick={clearSubmission}>
                                完成（允许新的恢复提交）
                            </Button>
                        </div>
                    )}
                </section>
            </div>
        );
    }

    const expectedAck = mode === "merge" ? "RESTORE" : "REPLACE";
    const canSubmit = file !== null && preview !== null && ack === expectedAck && !submitMutation.isPending;

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-5 lg:p-7">
            <PageHeading
                eyebrow="系统"
                title="数据库恢复"
                description="上传本系统导出的备份文件（.sql / .sql.gz）；合并补缺不覆盖现有数据，整库还原会先清空再插回。"
            />

            <section className="rounded-card border border-line bg-panel p-5">
                <h3 className="mb-3 text-14 font-semibold text-ink">① 选择备份文件</h3>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".sql,.gz,application/sql,application/gzip"
                    className="hidden"
                    onChange={event => {
                        const chosen = event.target.files?.[0] ?? null;
                        setFile(chosen);
                        setPreview(null);
                        if (chosen) {
                            previewMutation.mutate(chosen);
                        }
                    }}
                />
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface px-4 py-8 text-center transition-colors hover:bg-soft"
                >
                    <Icon name="upload" size={22} className="text-muted" />
                    {file ? (
                        <>
                            <span className="text-14 text-ink">{file.name}</span>
                            <span className="text-12 text-subtle">{(file.size / 1024).toFixed(1)} KB</span>
                        </>
                    ) : (
                        <span className="text-13 text-subtle">点击选择备份文件（上限 512MiB）</span>
                    )}
                </button>
                {previewMutation.isPending && (
                    <div className="mt-3 text-13 text-subtle">正在预检（校验格式/指纹/校验和）…</div>
                )}
                {preview && (
                    <div className="mt-3 grid gap-1.5 rounded-xl bg-soft px-3.5 py-3 text-13 text-td">
                        <span>
                            备份时间：<b>{new Date(preview.meta.createdAt).toLocaleString()}</b>
                        </span>
                        <span>
                            分组：
                            {preview.meta.groups.length} 组 · 表 {preview.meta.tables.length} 张 · 行数合计{" "}
                            {preview.meta.tables.reduce((sum, table) => sum + table.rowCount, 0)}
                        </span>
                        <span className="text-12 text-subtle">
                            迁移基线 {preview.meta.latestMigration} · 服务器 {preview.meta.serverVersion}
                        </span>
                    </div>
                )}
            </section>

            <section className="rounded-card border border-line bg-panel p-5">
                <h3 className="mb-3 text-14 font-semibold text-ink">② 恢复模式</h3>
                <div className="grid gap-2">
                    <label
                        className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-3 transition-colors ${
                            mode === "merge"
                                ? "border-primary-border bg-primary-soft"
                                : "border-line bg-surface hover:bg-soft"
                        }`}
                    >
                        <input
                            type="radio"
                            name="restore-mode"
                            className="mt-1 accent-primary"
                            checked={mode === "merge"}
                            onChange={() => setMode("merge")}
                        />
                        <span>
                            <span className="block text-14 font-medium text-ink">合并补缺（merge）</span>
                            <span className="block text-12 text-subtle">
                                只补插缺失行；主键已存在且内容一致跳过，不一致则整体回滚。日常补数据用。
                            </span>
                        </span>
                    </label>
                    <label
                        className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 transition-colors ${
                            mode === "replace"
                                ? "border-primary-border bg-primary-soft"
                                : preview?.canReplace
                                  ? "cursor-pointer border-line bg-surface hover:bg-soft"
                                  : "not-allowed border-line bg-soft opacity-60"
                        }`}
                    >
                        <input
                            type="radio"
                            name="restore-mode"
                            className="mt-1 accent-primary"
                            disabled={!preview?.canReplace}
                            checked={mode === "replace"}
                            onChange={() => setMode("replace")}
                        />
                        <span>
                            <span className="block text-14 font-medium text-ink">整库快照还原（replace）</span>
                            <span className="block text-12 text-subtle">
                                {preview?.canReplace
                                    ? "清空业务表后按备份插回；两次备份之间新增的数据会被删除，所有用户须重新登录。"
                                    : "仅完整备份可用于整库还原（当前文件为部分备份）。"}
                            </span>
                        </span>
                    </label>
                </div>
            </section>

            <section className="rounded-card border border-line bg-panel p-5">
                <h3 className="mb-2 text-14 font-semibold text-ink">③ 确认执行</h3>
                <p className="mb-2.5 text-13 text-subtle">
                    输入 <b className="text-td">{expectedAck}</b> 以确认（{mode === "merge" ? "合并" : "整库还原"}
                    模式）。 执行期间系统进入维护态，全部写请求返回 503。
                </p>
                <input
                    type="text"
                    value={ack}
                    onChange={event => setAck(event.target.value)}
                    placeholder={expectedAck}
                    className="w-full rounded-input border border-line bg-surface px-3.5 py-2.5 text-14 text-ink outline-none focus:border-primary-border"
                    autoComplete="off"
                    spellCheck={false}
                />
            </section>

            <div className="flex items-center justify-end gap-3">
                <span className="text-12 text-subtle">
                    提交后将生成 requestKey 并在本机留存；断线或重新登录后自动凭原 key 继续查询
                </span>
                <Button
                    className="min-h-9 px-4 text-14"
                    disabled={!canSubmit}
                    onClick={() => file && submitMutation.mutate({ file, mode, ack })}
                >
                    {submitMutation.isPending ? "正在提交…" : `确认恢复（${expectedAck}）`}
                </Button>
            </div>
        </div>
    );
}
