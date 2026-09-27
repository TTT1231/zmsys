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

const formatFileSize = (bytes: number): string =>
    bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;

function RestoreSteps({
    current,
    finished = false,
    failed = false,
}: {
    current: number;
    finished?: boolean;
    failed?: boolean;
}) {
    return (
        <nav
            className="rounded-panel border border-line bg-surface px-4 py-4 shadow-card sm:px-6"
            aria-label="恢复步骤"
        >
            <ol className="grid grid-cols-4 gap-2">
                {(["选择文件", "选择方式", "确认恢复", "查看结果"] as const).map((label, index) => {
                    const step = index + 1;
                    const complete = step < current || (finished && step === current);
                    return (
                        <li
                            key={label}
                            className="relative flex min-w-0 flex-col items-center gap-1.5 text-center"
                            aria-current={step === current && !finished ? "step" : undefined}
                        >
                            {step < 4 && (
                                <span
                                    className={`absolute top-3.5 left-1/2 h-0.5 w-full ${step < current ? "bg-success" : "bg-line"}`}
                                    aria-hidden="true"
                                />
                            )}
                            <span
                                className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-12 font-semibold sm:h-8 sm:w-8 ${failed && step === 4 ? "bg-danger-soft text-danger" : complete ? "bg-success-soft text-success" : step === current ? "bg-primary text-white" : "bg-soft text-muted"}`}
                            >
                                {failed && step === 4 ? (
                                    <Icon name="alert" size={15} />
                                ) : complete ? (
                                    <Icon name="check" size={15} />
                                ) : (
                                    step
                                )}
                            </span>
                            <span
                                className={`text-12 font-medium whitespace-nowrap ${failed && step === 4 ? "text-danger" : step === current ? "text-ink" : complete ? "text-success" : "text-muted"}`}
                            >
                                {label}
                            </span>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}

/** 数据库恢复（仅超管）：选文件 → 预检 → 模式与确认口令 → 提交后轮询凭证 */
export function RestorePage() {
    const { can } = useApp();
    const toast = useToast();
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<BackupPreviewResult | null>(null);
    const [mode, setMode] = useState<RestoreMode | null>(null);
    const [ack, setAck] = useState("");
    const [pending, setPending] = useState<PendingSubmission | null>(() => loadPending());
    const [job, setJob] = useState<RestoreJob | null>(null);
    const [notFound, setNotFound] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const selectedFileRef = useRef<File | null>(null);
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
        onSuccess: (result, target) => {
            if (selectedFileRef.current !== target) return;
            setPreview(result);
            setAck("");
        },
        onError: (error: Error, target) => {
            if (selectedFileRef.current !== target) return;
            setPreview(null);
            toast(error.message || "预检失败：文件不合法或与当前库结构不符", true);
        },
    });

    const chooseFile = (chosen: File | null) => {
        selectedFileRef.current = chosen;
        setFile(chosen);
        setPreview(null);
        setMode(null);
        setAck("");
        previewMutation.reset();
        if (chosen) previewMutation.mutate(chosen);
    };

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
            RUNNING: "正在恢复数据",
            UNKNOWN: "正在核实提交结果",
            SUCCEEDED: "数据恢复完成",
            SUCCEEDED_AUDIT_FAILED: "恢复完成，审计记录需检查",
            FAILED: "恢复失败，数据已回滚",
        };
        const currentStatus = job?.status ?? "UNKNOWN";
        const finished = job !== null && TERMINAL.has(job.status);
        const showJobDetails = notFound || finished || Boolean(job?.errorText || job?.report?.tables);
        return (
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-5 lg:p-7">
                <PageHeading title="数据恢复" description="此页面会持续查询任务结果，重新登录后也可继续查看。" />
                <RestoreSteps current={4} finished={finished} failed={job?.status === "FAILED"} />
                <div className="grid items-start gap-5 lg:grid-cols-3">
                    <section
                        className="overflow-hidden rounded-panel border border-line bg-surface shadow-card lg:col-span-2"
                        aria-labelledby="restore-status-title"
                    >
                        <div
                            className={`flex items-start gap-4 border-b border-line p-5 sm:p-6 ${currentStatus === "FAILED" ? "bg-danger-soft" : finished ? "bg-success-soft" : "bg-primary-soft/50"}`}
                            role="status"
                            aria-live="polite"
                        >
                            <span
                                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${currentStatus === "FAILED" ? "bg-danger text-white" : finished ? "bg-success text-white" : "bg-primary text-white"}`}
                            >
                                <Icon
                                    name={finished ? (currentStatus === "FAILED" ? "alert" : "check") : "refresh"}
                                    size={22}
                                    className={finished ? "" : "animate-spin motion-reduce:animate-none"}
                                />
                            </span>
                            <div className="min-w-0">
                                <h2 id="restore-status-title" className="text-20 font-semibold text-ink">
                                    {statusText[currentStatus] ?? currentStatus}
                                </h2>
                                <p className="mt-1 text-14 text-td-strong">
                                    {currentStatus === "RUNNING"
                                        ? "执行期间系统暂时停止写入，请等待结果。"
                                        : currentStatus === "UNKNOWN"
                                          ? "正在确认任务是否已受理，请保持此页打开。"
                                          : currentStatus === "SUCCEEDED_AUDIT_FAILED"
                                            ? "数据已恢复；请查看服务日志中的审计补记问题。"
                                            : currentStatus === "FAILED"
                                              ? "本次操作未生效，可查看下方错误后重新处理。"
                                              : "备份数据已成功写入。"}
                                </p>
                            </div>
                        </div>
                        {showJobDetails && (
                            <div className="p-5 sm:p-6">
                                {notFound && !finished && (
                                    <div className="rounded-card border border-warning/30 bg-warning-soft p-4 text-13 leading-5 text-warning-strong">
                                        <div className="flex items-start gap-2">
                                            <Icon name="info" size={17} className="mt-0.5 shrink-0" />
                                            <p>
                                                暂未查到任务记录。文件可能仍在上传或预检中，页面会继续自动查询。若长时间无结果，可用原文件和原任务编号重新提交。
                                            </p>
                                        </div>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept=".sql,.gz,application/sql,application/gzip"
                                            className="hidden"
                                            onChange={event => setFile(event.target.files?.[0] ?? null)}
                                        />
                                        <div className="mt-4 flex flex-wrap items-center gap-2">
                                            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                                                {file ? `已选：${file.name}` : "重新选择原文件"}
                                            </Button>
                                            <Button
                                                disabled={file?.name !== pending.fileName || submitMutation.isPending}
                                                onClick={() =>
                                                    file &&
                                                    submitMutation.mutate({
                                                        file,
                                                        mode: pending.mode,
                                                        ack: pending.mode === "merge" ? "RESTORE" : "REPLACE",
                                                    })
                                                }
                                            >
                                                {submitMutation.isPending ? "正在重新提交…" : "使用原任务编号重试"}
                                            </Button>
                                        </div>
                                        {file && file.name !== pending.fileName && (
                                            <p className="mt-2 text-danger-strong">请选择原文件：{pending.fileName}</p>
                                        )}
                                    </div>
                                )}
                                {job?.status === "FAILED" && job.errorText && (
                                    <div
                                        className="rounded-card border border-danger/30 bg-danger-soft p-4 text-13 leading-5 text-danger-strong"
                                        role="alert"
                                    >
                                        <div className="font-semibold">失败原因</div>
                                        <p className="mt-1">{job.errorText}</p>
                                    </div>
                                )}
                                {job?.report?.tables && job.status !== "FAILED" && (
                                    <div>
                                        <h3 className="text-15 font-semibold text-ink">数据处理明细</h3>
                                        <div className="mt-3 max-h-72 overflow-auto rounded-card border border-line">
                                            <table className="w-full min-w-96 text-left text-13">
                                                <thead className="sticky top-0 bg-soft text-12 text-muted">
                                                    <tr>
                                                        <th className="px-4 py-3 font-medium">数据表</th>
                                                        <th className="px-4 py-3 font-medium">已插入</th>
                                                        <th className="px-4 py-3 font-medium">已跳过</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {job.report.tables.map(table => (
                                                        <tr key={table.name} className="border-t border-line">
                                                            <td className="px-4 py-2.5 text-td">{table.name}</td>
                                                            <td className="px-4 py-2.5 tabular-nums text-td">
                                                                {table.inserted}
                                                            </td>
                                                            <td className="px-4 py-2.5 tabular-nums text-td">
                                                                {table.skipped}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                                {(job?.status === "SUCCEEDED" || job?.status === "SUCCEEDED_AUDIT_FAILED") &&
                                    pending.mode === "replace" && (
                                        <div className="mt-4 rounded-card border border-warning/30 bg-warning-soft p-4 text-13 leading-5 text-warning-strong">
                                            所有用户会话已失效，请重新登录。
                                            {job.report?.tokenVersionsRaised
                                                ? `涉及 ${job.report.tokenVersionsRaised} 个账号。`
                                                : ""}
                                        </div>
                                    )}
                                {finished && (
                                    <div className="mt-5 flex justify-end">
                                        <Button onClick={clearSubmission}>完成并返回</Button>
                                    </div>
                                )}
                            </div>
                        )}
                    </section>
                    <aside
                        className="rounded-panel border border-line bg-surface p-5 shadow-card"
                        aria-label="本次恢复任务"
                    >
                        <h2 className="text-16 font-semibold text-ink">本次任务</h2>
                        <dl className="mt-4 space-y-4 text-13">
                            <div>
                                <dt className="text-muted">备份文件</dt>
                                <dd className="mt-1 break-all font-medium text-ink">{pending.fileName}</dd>
                            </div>
                            <div>
                                <dt className="text-muted">恢复方式</dt>
                                <dd className="mt-1 font-medium text-ink">
                                    {pending.mode === "merge" ? "合并补缺" : "整库还原"}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-muted">提交时间</dt>
                                <dd className="mt-1 text-td">{new Date(pending.submittedAt).toLocaleString()}</dd>
                            </div>
                            {job?.finishedAt && (
                                <div>
                                    <dt className="text-muted">完成时间</dt>
                                    <dd className="mt-1 text-td">{new Date(job.finishedAt).toLocaleString()}</dd>
                                </div>
                            )}
                        </dl>
                        <div className="mt-5 border-t border-line pt-4">
                            <div className="text-12 text-muted">任务编号 · 断线后查询依据</div>
                            <div className="mt-2 flex items-start gap-2">
                                <code className="min-w-0 flex-1 break-all rounded-input bg-soft px-3 py-2 text-12 text-td">
                                    {pending.requestKey}
                                </code>
                                <button
                                    type="button"
                                    aria-label="复制任务编号"
                                    title="复制任务编号"
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-input border border-line text-muted hover:text-primary-strong focus-visible:outline-2 focus-visible:outline-primary"
                                    onClick={() =>
                                        void navigator.clipboard.writeText(pending.requestKey).then(
                                            () => toast("任务编号已复制"),
                                            () => toast("复制失败，请手动选择任务编号", true),
                                        )
                                    }
                                >
                                    <Icon name="copy" size={16} />
                                </button>
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
        );
    }

    const expectedAck = mode === "merge" ? "RESTORE" : mode === "replace" ? "REPLACE" : "";
    const currentStep = preview === null ? 1 : mode === null ? 2 : 3;
    const canSubmit =
        file !== null && preview !== null && mode !== null && ack === expectedAck && !submitMutation.isPending;

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-5 lg:p-7">
            <PageHeading title="数据恢复" description="上传备份文件并预检，确认恢复方式后执行。" />
            <RestoreSteps current={currentStep} />
            <div className="grid items-start gap-5 lg:grid-cols-3">
                <div className="flex flex-col gap-5 lg:col-span-2">
                    <section
                        className="rounded-panel border border-line bg-surface p-5 shadow-card sm:p-6"
                        aria-labelledby="restore-file-title"
                    >
                        <h2 id="restore-file-title" className="text-17 font-semibold text-ink">
                            选择备份文件
                        </h2>
                        <p className="mt-0.5 text-13 text-muted">选择后自动预检文件。</p>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".sql,.gz,application/sql,application/gzip"
                            className="hidden"
                            onChange={event => {
                                chooseFile(event.target.files?.[0] ?? null);
                                event.target.value = "";
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="mt-5 flex min-h-36 w-full cursor-pointer flex-col items-center justify-center rounded-card border border-dashed border-line-strong bg-soft px-5 py-6 text-center transition-colors hover:border-primary-border hover:bg-primary-soft/40 focus-visible:outline-2 focus-visible:outline-primary"
                        >
                            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-primary-strong shadow-xs">
                                <Icon name={file ? "file" : "upload"} size={22} />
                            </span>
                            <span className="mt-3 max-w-full break-all text-14 font-medium text-ink">
                                {file ? file.name : "点击选择备份文件"}
                            </span>
                            <span className="mt-1 text-13 text-muted">
                                {file
                                    ? `${formatFileSize(file.size)} · 点击更换文件`
                                    : "支持 .sql 和 .sql.gz，最大 512 MB"}
                            </span>
                        </button>
                        {previewMutation.isPending && (
                            <div className="mt-4 flex items-center gap-2 text-13 text-primary-strong" role="status">
                                <Icon name="refresh" size={16} className="animate-spin motion-reduce:animate-none" />
                                正在预检文件…
                            </div>
                        )}
                        {previewMutation.isError && (
                            <div
                                className="mt-4 rounded-card border border-danger/30 bg-danger-soft p-4 text-13 text-danger-strong"
                                role="alert"
                            >
                                预检未通过：{previewMutation.error.message || "文件不合法或与当前数据库结构不符"}
                                。请选择其他备份文件。
                            </div>
                        )}
                        {preview && (
                            <div className="mt-4 rounded-card border border-success/25 bg-success-soft/40 p-4">
                                <div className="flex items-center gap-2 text-14 font-semibold text-success">
                                    <Icon name="check" size={18} />
                                    预检通过
                                </div>
                                <dl className="mt-4 grid gap-4 sm:grid-cols-3">
                                    <div>
                                        <dt className="text-12 text-muted">备份时间</dt>
                                        <dd className="mt-1 text-13 font-medium text-ink">
                                            {new Date(preview.meta.createdAt).toLocaleString()}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-12 text-muted">业务分组 / 数据表</dt>
                                        <dd className="mt-1 text-13 font-medium text-ink">
                                            {preview.meta.groups.length} 组 / {preview.meta.tables.length} 张
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-12 text-muted">数据行数</dt>
                                        <dd className="mt-1 text-13 font-medium tabular-nums text-ink">
                                            {preview.meta.tables
                                                .reduce((sum, table) => sum + table.rowCount, 0)
                                                .toLocaleString()}
                                        </dd>
                                    </div>
                                </dl>
                            </div>
                        )}
                    </section>

                    <section
                        className="rounded-panel border border-line bg-surface p-5 shadow-card sm:p-6"
                        aria-labelledby="restore-mode-title"
                    >
                        <h2 id="restore-mode-title" className="text-17 font-semibold text-ink">
                            选择恢复方式
                        </h2>
                        <p className="mt-0.5 text-13 text-muted">整库还原仅支持完整备份。</p>
                        <div
                            className="mt-5 grid gap-3 sm:grid-cols-2"
                            role="radiogroup"
                            aria-labelledby="restore-mode-title"
                        >
                            <label
                                className={`flex flex-col rounded-card border p-4 transition-colors focus-within:ring-2 focus-within:ring-primary-border ${mode === "merge" ? "cursor-pointer border-primary-border bg-primary-soft/50" : preview ? "cursor-pointer border-line bg-panel hover:border-line-strong" : "cursor-not-allowed border-line bg-soft"}`}
                            >
                                <span className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="restore-mode"
                                        className="h-4 w-4 accent-primary"
                                        disabled={!preview}
                                        checked={mode === "merge"}
                                        onChange={() => {
                                            setMode("merge");
                                            setAck("");
                                        }}
                                    />
                                    <span className="text-14 font-semibold text-ink">合并补缺</span>
                                </span>
                                <span className="mt-3 text-13 leading-5 text-td-strong">
                                    仅插入缺失的数据；已有且相同的数据会跳过。如出现冲突，整次操作回滚。
                                </span>
                                <span className="mt-auto pt-3 text-12 font-medium text-primary-strong">
                                    适合补回遗漏数据
                                </span>
                            </label>
                            <label
                                className={`flex flex-col rounded-card border p-4 transition-colors focus-within:ring-2 focus-within:ring-primary-border ${mode === "replace" ? "border-warning/50 bg-warning-soft" : preview?.canReplace ? "cursor-pointer border-line bg-panel hover:border-warning/50" : "cursor-not-allowed border-line bg-soft"}`}
                            >
                                <span className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="restore-mode"
                                        className="h-4 w-4 accent-primary"
                                        disabled={!preview?.canReplace}
                                        checked={mode === "replace"}
                                        onChange={() => {
                                            setMode("replace");
                                            setAck("");
                                        }}
                                    />
                                    <span className="text-14 font-semibold text-ink">整库还原</span>
                                </span>
                                <span className="mt-3 text-13 leading-5 text-td-strong">
                                    清空现有业务数据，再写入备份。备份之后新增的数据会丢失，所有用户需要重新登录。
                                </span>
                                <span
                                    className={`mt-auto pt-3 text-12 font-medium ${preview?.canReplace ? "text-warning-strong" : "text-muted"}`}
                                >
                                    {preview
                                        ? preview.canReplace
                                            ? "此文件支持整库还原"
                                            : "此文件是部分备份，无法整库还原"
                                        : "预检完整备份后可选择"}
                                </span>
                            </label>
                        </div>
                    </section>

                    <section
                        className="rounded-panel border border-line bg-surface p-5 shadow-card sm:p-6"
                        aria-labelledby="restore-confirm-title"
                    >
                        <h2 id="restore-confirm-title" className="text-17 font-semibold text-ink">
                            确认执行
                        </h2>
                        <p className="mt-0.5 text-13 text-muted">核对文件和恢复方式后输入确认词。</p>
                        <label htmlFor="restore-ack" className="mt-5 block text-13 font-medium text-td-strong">
                            {mode ? (
                                <>
                                    输入{" "}
                                    <code className="rounded-md bg-soft px-1.5 py-0.5 font-semibold text-ink">
                                        {expectedAck}
                                    </code>{" "}
                                    以确认{mode === "merge" ? "合并补缺" : "整库还原"}
                                </>
                            ) : (
                                "请先选择恢复方式"
                            )}
                        </label>
                        <input
                            id="restore-ack"
                            type="text"
                            value={ack}
                            onChange={event => setAck(event.target.value)}
                            disabled={mode === null}
                            aria-invalid={ack.length > 0 && ack !== expectedAck}
                            aria-describedby={ack && ack !== expectedAck ? "restore-ack-hint" : undefined}
                            placeholder="请输入上方确认词"
                            className="mt-2 w-full rounded-input border border-line-strong bg-surface px-3.5 py-2.5 text-14 text-ink outline-none focus:border-primary-border focus:ring-2 focus:ring-primary-border/50"
                            autoComplete="off"
                            spellCheck={false}
                        />
                        {ack && ack !== expectedAck && (
                            <p id="restore-ack-hint" className="mt-2 text-12 text-danger-strong">
                                确认词不匹配，请按原样输入。
                            </p>
                        )}
                    </section>
                </div>

                <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
                    <section
                        className="rounded-panel border border-line bg-surface p-5 shadow-card"
                        aria-labelledby="restore-summary-title"
                    >
                        <h2 id="restore-summary-title" className="text-16 font-semibold text-ink">
                            执行摘要
                        </h2>
                        <dl className="mt-4 space-y-4 text-13">
                            <div>
                                <dt className="text-muted">备份文件</dt>
                                <dd className="mt-1 break-all font-medium text-ink">{file?.name ?? "尚未选择"}</dd>
                            </div>
                            <div>
                                <dt className="text-muted">预检状态</dt>
                                <dd
                                    className={`mt-1 font-medium ${preview ? "text-success" : previewMutation.isError ? "text-danger-strong" : "text-td-strong"}`}
                                >
                                    {preview
                                        ? "已通过"
                                        : previewMutation.isPending
                                          ? "正在检查"
                                          : previewMutation.isError
                                            ? "未通过"
                                            : "等待文件"}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-muted">恢复方式</dt>
                                <dd className="mt-1 font-medium text-ink">
                                    {mode === "merge" ? "合并补缺" : mode === "replace" ? "整库还原" : "尚未选择"}
                                </dd>
                            </div>
                        </dl>
                        {mode === "replace" && (
                            <p className="mt-4 rounded-card bg-warning-soft p-3 text-13 leading-5 text-warning-strong">
                                整库还原会删除备份之后新增的数据。
                            </p>
                        )}
                        <Button
                            variant={mode === "replace" ? "danger" : "primary"}
                            className="mt-5 w-full"
                            disabled={!canSubmit}
                            onClick={() => file && mode && submitMutation.mutate({ file, mode, ack })}
                        >
                            {submitMutation.isPending ? "正在提交任务…" : "开始恢复"}
                        </Button>
                        <p className="mt-3 text-12 leading-5 text-muted">提交后自动跟踪任务结果。</p>
                    </section>
                    <div className="rounded-card border border-warning/30 bg-warning-soft p-4 text-13 leading-5 text-warning-strong">
                        <div className="flex items-start gap-2">
                            <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
                            <p>请在业务低峰期操作。恢复期间系统写入会暂停，整库还原还会让当前登录会话失效。</p>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    );
}
