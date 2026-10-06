import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Icon } from "@/lib/icons";
import { Button } from "@/components/ui/Button";
import { fetchRestoreJobByKey, previewRestore, runRestore } from "@/api";
import { useToast } from "@/components/ui/toastContexts";
import { useApp } from "@/context/useApp";
import { formatDateTime } from "@/lib/date";
import { copyText } from "@/lib/clipboard";
import { isApiError } from "@/http/errors";
import { bytesToHex } from "@/lib/utils";
import type { BackupPreviewResult, RestoreJob, RestoreJobStatus, RestoreMode } from "@/api";

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

const TERMINAL: ReadonlySet<RestoreJobStatus> = new Set(["SUCCEEDED", "SUCCEEDED_AUDIT_FAILED", "FAILED"]);

const newRequestKey = (): string => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
};

const formatFileSize = (bytes: number): string =>
    bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;

/** 与服务端一致的客户端快速校验：明显不合法的文件不发起上传 */
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const localFileError = (file: File): string =>
    !/\.sql(\.gz)?$/i.test(file.name)
        ? "请选择 .sql 或 .sql.gz 格式的备份。"
        : file.size === 0
          ? "文件为空，请重新选择。"
          : file.size > MAX_FILE_BYTES
            ? "文件超过 512 MB，请重新选择。"
            : "";

const STEPS = ["备份文件", "恢复方式", "确认恢复", "恢复结果"] as const;

const modeLabel = (mode: RestoreMode): string => (mode === "replace" ? "恢复至备份状态" : "补充缺失数据");
const ackWord = (mode: RestoreMode): string => (mode === "replace" ? "REPLACE" : "RESTORE");

/** 原型左侧步骤轨道：纵向圆点 + 连接线，未提交任务时已完成步骤可点击回退（窄屏转为顶部横向） */
function StepRail({ step, onGoto }: { step: number; onGoto: (step: number) => void }) {
    return (
        <nav className="border-b border-line bg-soft px-4 py-5 md:border-b-0 md:border-r md:py-9" aria-label="恢复步骤">
            <ol className="grid grid-cols-4 gap-2 md:flex md:flex-col md:gap-0">
                {STEPS.map((label, index) => {
                    const n = index + 1;
                    const complete = n < step;
                    const current = n === step;
                    const state = complete ? "done" : current ? "current" : "todo";
                    const dotClass =
                        state === "current"
                            ? "border-primary bg-primary text-white ring-4 ring-primary-soft"
                            : state === "done"
                              ? "border-primary bg-surface text-primary"
                              : "border-line-strong bg-soft text-muted";
                    const labelClass =
                        state === "current" ? "font-semibold text-ink" : complete ? "text-td" : "text-muted";
                    const item = (
                        <>
                            <span
                                aria-hidden="true"
                                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-12 tabular-nums ${dotClass}`}
                            >
                                {state === "done" ? <Icon name="check" size={14} /> : n}
                            </span>
                            <span className={`text-13 ${labelClass}`}>{label}</span>
                        </>
                    );
                    return (
                        <li key={label} className="relative md:pb-7 md:last:pb-0">
                            {n < STEPS.length && (
                                <span
                                    aria-hidden="true"
                                    className="absolute top-3.5 left-[calc(50%+22px)] h-px w-[calc(100%-44px)] bg-line md:top-9 md:bottom-1.5 md:left-3.5 md:h-auto md:w-px"
                                />
                            )}
                            {complete ? (
                                <button
                                    type="button"
                                    onClick={() => onGoto(n)}
                                    aria-current={current ? "step" : undefined}
                                    className="flex min-w-0 flex-col items-center gap-2 md:w-full md:flex-row md:gap-3"
                                >
                                    {item}
                                </button>
                            ) : (
                                <span
                                    aria-current={current ? "step" : undefined}
                                    className="flex min-w-0 flex-col items-center gap-2 md:flex-row md:gap-3"
                                >
                                    {item}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}

/** 原型 .opt 方式卡片：标题 + 说明在左，radio 在右；disabled 表示备份不完整仅支持补缺 */
function ModeOption({
    value,
    title,
    description,
    tag,
    disabled = false,
    checked,
    onSelect,
}: {
    value: RestoreMode;
    title: string;
    description: string;
    tag?: string;
    disabled?: boolean;
    checked: boolean;
    onSelect: () => void;
}) {
    return (
        <label
            className={`grid grid-cols-[minmax(0,1fr)_18px] items-start gap-5 rounded-card border p-5 transition-colors ${
                disabled
                    ? "cursor-not-allowed border-line bg-soft"
                    : checked
                      ? "cursor-pointer border-primary bg-primary-soft"
                      : "cursor-pointer border-line-strong bg-surface hover:border-primary"
            }`}
        >
            <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-15 font-semibold text-ink">
                    {title}
                    {tag && (
                        <span className="rounded border border-primary-border px-1.5 text-11 leading-5 font-normal text-primary-strong">
                            {tag}
                        </span>
                    )}
                </span>
                <span className={`mt-2 block text-13 leading-relaxed ${disabled ? "text-muted" : "text-td-strong"}`}>
                    {description}
                </span>
            </span>
            <input
                type="radio"
                name="restore-mode"
                value={value}
                className="mt-0.5 h-4.5 w-4.5 accent-primary"
                checked={checked}
                disabled={disabled}
                onChange={onSelect}
                aria-label={title}
            />
        </label>
    );
}

/** 数据库恢复（仅超管）：四步向导 —— 选文件预检 → 方式 → 确认口令 → 提交后轮询凭证 */
export function RestorePage() {
    const { can } = useApp();
    const toast = useToast();
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [file, setFile] = useState<File | null>(null);
    const [localError, setLocalError] = useState("");
    const [preview, setPreview] = useState<BackupPreviewResult | null>(null);
    const [mode, setMode] = useState<RestoreMode | null>(null);
    const [ack, setAck] = useState("");
    const [dragOver, setDragOver] = useState(false);
    const [pending, setPending] = useState<PendingSubmission | null>(() => loadPending());
    const [job, setJob] = useState<RestoreJob | null>(null);
    const [notFound, setNotFound] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const fileInputRef = useRef<HTMLInputElement>(null);
    const originalInputRef = useRef<HTMLInputElement>(null);
    const selectedFileRef = useRef<File | null>(null);
    const pollTimer = useRef<number | null>(null);
    const headingRef = useRef<HTMLHeadingElement | null>(null);
    const lastFocusKey = useRef("");

    useEffect(() => {
        if (pending) {
            localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
        } else {
            localStorage.removeItem(PENDING_KEY);
        }
    }, [pending]);

    const focusKey = pending ? "result" : `step-${step}`;
    useEffect(() => {
        if (lastFocusKey.current === "") {
            lastFocusKey.current = focusKey;
            return;
        }
        if (lastFocusKey.current === focusKey) return;
        lastFocusKey.current = focusKey;
        // 步骤切换后把焦点移到新面板标题（原型 .h 的焦点管理），键盘/读屏用户不丢语境
        headingRef.current?.focus({ preventScroll: true });
    }, [focusKey]);

    const previewMutation = useMutation({
        mutationFn: (target: File) => previewRestore(target),
        onSuccess: (result, target) => {
            if (selectedFileRef.current !== target) return;
            setPreview(result);
            setMode("merge"); // 预检通过默认选中推荐项「补充缺失数据」，可改选整库还原
            setAck("");
        },
        onError: (_error: Error, target) => {
            if (selectedFileRef.current !== target) return;
            setPreview(null);
            setMode(null);
            setAck("");
        },
    });

    /** 选文件后立即预检；客户端校验不过的文件直接拒收，不出现在已选卡片上 */
    const acceptFile = (candidate: File | null | undefined) => {
        if (!candidate) return;
        const error = localFileError(candidate);
        selectedFileRef.current = candidate;
        setFile(candidate);
        setLocalError(error);
        setPreview(null);
        setMode(null);
        setAck("");
        previewMutation.reset();
        if (!error) previewMutation.mutate(candidate);
    };

    const clearSubmission = useCallback(() => {
        setPending(null);
        setJob(null);
        setNotFound(false);
        localStorage.removeItem(PENDING_KEY);
    }, []);

    const clearAll = useCallback(() => {
        clearSubmission();
        selectedFileRef.current = null;
        setFile(null);
        setLocalError("");
        setPreview(null);
        setMode(null);
        setAck("");
        previewMutation.reset();
        setStep(1);
    }, [clearSubmission, previewMutation]);

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
            if (TERMINAL.has(outcome.status)) {
                // 同 key 重提：服务端回放原终态
                if (outcome.job) setJob(outcome.job);
                return;
            }
            toast.success("恢复任务已受理，执行期间系统进入维护态");
        },
        onError: (error: Error) => {
            // 确定性拒绝（400 预检/409 冲突/413 超限/404 路由）：回提交表单纠错重试；
            // 网络错误/超时/-1 保留原 key 继续轮询（结果不明不得换 key）
            const code = isApiError(error) ? error.code : -1;
            if (code === 400 || code === 409 || code === 413 || code === 404) {
                clearSubmission();
                toast.error(error.message || "提交被拒绝，请调整后重试");
                return;
            }
            toast.error(error.message || "提交失败（requestKey 已保留，可稍后重查）");
        },
    });

    /** 轮询：401（replace 抬升 token_version / 会话过期）不判作恢复失败，重登录后自动继续 */
    const pollJob = useCallback(async (requestKey: string) => {
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
            const status = (error as { status?: number; code?: number }).status ?? (error as { code?: number }).code;
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
    }, []);

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

    const jobFinished = job !== null && TERMINAL.has(job.status);
    // 未到终态期间每秒刷新一次等待/用时显示（时钟起点 = 提交时刻，单调且不依赖轮询返回；
    // now 取挂载时刻初始化，pending 晚于挂载出现时 elapsed 被 max(0,…) 钳到 0，首秒无误导值）
    useEffect(() => {
        if (!pending || jobFinished) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [pending, jobFinished]);
    const elapsedSeconds = pending ? Math.max(0, Math.floor((now - Date.parse(pending.submittedAt)) / 1000)) : 0;

    if (!can("system-restore:run")) {
        return <div className="p-6 text-14 text-subtle">仅超级管理员可访问数据库恢复。</div>;
    }

    // —— 已有待核实提交：向导进入第 4 步展示任务进度，不展示提交表单 ——
    if (pending) {
        const jobStatus = job?.status ?? "UNKNOWN";
        const failed = jobStatus === "FAILED";
        const finished = TERMINAL.has(jobStatus);
        const running = jobStatus === "RUNNING";
        const title = failed
            ? "恢复失败"
            : jobStatus === "SUCCEEDED"
              ? "恢复完成"
              : jobStatus === "SUCCEEDED_AUDIT_FAILED"
                ? "恢复完成，审计记录需检查"
                : running
                  ? "正在恢复数据"
                  : "正在核实提交结果";
        const description = failed
            ? "本次更改已撤销，原有数据未变。"
            : jobStatus === "SUCCEEDED_AUDIT_FAILED"
              ? "数据已恢复；请查看服务日志中的审计补记问题。"
              : jobStatus === "SUCCEEDED"
                ? pending.mode === "replace"
                    ? "数据已恢复至备份状态。"
                    : "缺失数据已补回，原有数据未变。"
                : running
                  ? "执行期间系统暂停写入，请保持此页打开。"
                  : "尚未收到结果，页面会持续自动查询。";
        return (
            <div className="w-full p-5 lg:p-7">
                <section
                    className="overflow-hidden rounded-panel border border-line bg-surface shadow-card"
                    aria-label="恢复结果"
                >
                    <div className="px-6 py-7 sm:px-10 sm:py-9">
                        <div role="status" aria-live="polite" className="flex items-start gap-4">
                            <span
                                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${failed ? "bg-danger-soft text-danger" : finished ? "bg-success-soft text-success" : "bg-primary-soft text-primary-strong"}`}
                            >
                                <Icon
                                    name={finished ? (failed ? "alert" : "check") : "refresh"}
                                    size={22}
                                    className={finished ? "" : "animate-spin motion-reduce:animate-none"}
                                />
                            </span>
                            <div className="min-w-0">
                                <h2
                                    ref={headingRef}
                                    tabIndex={-1}
                                    className="text-20 font-semibold text-ink outline-none"
                                >
                                    {title}
                                </h2>
                                <p className="mt-1 text-13 leading-relaxed text-td-strong">{description}</p>
                            </div>
                        </div>

                        {!finished && (
                            <div className="mt-9">
                                <div className="h-1.5 overflow-hidden rounded-full bg-line/70" role="progressbar">
                                    <div className="h-full w-[35%] animate-indeterminate rounded-full bg-primary motion-reduce:animate-none motion-reduce:w-full motion-reduce:opacity-50" />
                                </div>
                                <div className="mt-3.5 flex flex-wrap items-baseline justify-between gap-2 text-12 text-muted">
                                    <p className="text-td">{running ? "正在写入业务数据" : "正在查询任务状态"}</p>
                                    <p className="tabular-nums">
                                        {running ? "已用时" : "已等待"} {elapsedSeconds} 秒
                                    </p>
                                </div>
                            </div>
                        )}

                        {notFound && !finished && (
                            <div className="mt-6 rounded-card border border-warning/30 bg-warning-soft p-4 text-13 leading-relaxed text-warning-strong">
                                <div className="flex items-start gap-2">
                                    <Icon name="info" size={17} className="mt-0.5 shrink-0" />
                                    <p>
                                        暂未查到任务记录，文件可能仍在上传或预检中。若长时间无结果，可用原备份文件按原任务编号重新提交。
                                    </p>
                                </div>
                                <input
                                    ref={originalInputRef}
                                    type="file"
                                    accept=".sql,.gz,application/sql,application/gzip"
                                    className="hidden"
                                    onChange={event => setFile(event.target.files?.[0] ?? null)}
                                />
                                <div className="mt-4 flex flex-wrap items-center gap-2">
                                    <Button variant="secondary" onClick={() => originalInputRef.current?.click()}>
                                        {file?.name === pending.fileName ? "已选原文件" : "选择原文件"}
                                    </Button>
                                    <Button
                                        disabled={file?.name !== pending.fileName || submitMutation.isPending}
                                        onClick={() =>
                                            file &&
                                            submitMutation.mutate({
                                                file,
                                                mode: pending.mode,
                                                ack: ackWord(pending.mode),
                                            })
                                        }
                                    >
                                        {submitMutation.isPending ? "正在重新提交…" : "重新提交"}
                                    </Button>
                                </div>
                                {file && file.name !== pending.fileName && (
                                    <p className="mt-2 text-danger-strong">请选择原文件：{pending.fileName}</p>
                                )}
                            </div>
                        )}

                        {failed && job?.errorText && (
                            <div
                                role="alert"
                                className="mt-7 rounded-card border border-danger/30 bg-danger-soft p-4 text-13 leading-relaxed text-danger-strong"
                            >
                                <div className="font-semibold">失败原因</div>
                                <p className="mt-1 break-all">{job.errorText}</p>
                            </div>
                        )}

                        {!failed && job?.report?.tables && job.report.tables.length > 0 && (
                            <div className="mt-8">
                                <h3 className="text-13 font-medium text-td">恢复明细</h3>
                                <div className="mt-3 max-h-72 overflow-auto rounded-card border border-line">
                                    <table className="w-full min-w-96 border-collapse text-left text-13">
                                        <thead className="sticky top-0 bg-soft text-12 text-muted">
                                            <tr>
                                                <th className="px-4 py-2.5 font-medium">业务数据</th>
                                                <th className="px-4 py-2.5 text-right font-medium">已插入</th>
                                                <th className="px-4 py-2.5 text-right font-medium">已跳过</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {job.report.tables.map(table => (
                                                <tr key={table.name} className="border-t border-line text-td">
                                                    <td className="px-4 py-2.5">{table.name}</td>
                                                    <td className="px-4 py-2.5 text-right tabular-nums">
                                                        {table.inserted.toLocaleString()}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right tabular-nums">
                                                        {table.skipped.toLocaleString()}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr className="border-t border-line font-semibold text-ink">
                                                <td className="px-4 py-3">合计</td>
                                                <td className="px-4 py-3 text-right tabular-nums">
                                                    {job.report.tables
                                                        .reduce((sum, table) => sum + table.inserted, 0)
                                                        .toLocaleString()}
                                                </td>
                                                <td className="px-4 py-3 text-right tabular-nums">
                                                    {job.report.tables
                                                        .reduce((sum, table) => sum + table.skipped, 0)
                                                        .toLocaleString()}
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        )}

                        {finished && !failed && pending.mode === "replace" && (
                            <div className="mt-5 rounded-card border border-warning/30 bg-warning-soft p-4 text-13 leading-relaxed text-warning-strong">
                                所有用户会话已失效，请重新登录。
                                {job?.report?.tokenVersionsRaised
                                    ? `涉及 ${job.report.tokenVersionsRaised} 个账号。`
                                    : ""}
                            </div>
                        )}

                        <div className="mt-8 border-t border-line pt-4">
                            <div className="text-12 text-muted">
                                任务编号 · 报障或排查时提供；断线或刷新后，回到本页将自动继续查询
                            </div>
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
                                        void copyText(pending.requestKey).then(ok =>
                                            ok
                                                ? toast.success("任务编号已复制")
                                                : toast.error("复制失败，请手动选择任务编号"),
                                        )
                                    }
                                >
                                    <Icon name="copy" size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                    {finished && (
                        <div className="flex min-h-[76px] flex-wrap items-center justify-end gap-3 border-t border-line px-6 py-4 sm:px-10">
                            <Button onClick={clearAll}>{failed ? "重新选择文件" : "完成"}</Button>
                        </div>
                    )}
                </section>
            </div>
        );
    }

    const expectedAck = mode ? ackWord(mode) : "";
    const canSubmit =
        file !== null && preview !== null && mode !== null && ack === expectedAck && !submitMutation.isPending;

    const next = () => {
        if (step === 1 && preview) setStep(2);
        else if (step === 2 && mode) setStep(3);
    };
    const gotoStep = (target: number) => {
        if (target >= step) return;
        if (target >= 2 && !preview) return;
        if (target >= 3 && !mode) return;
        setStep(target as 1 | 2 | 3);
    };
    const start = () => {
        if (!file || !mode || ack !== ackWord(mode) || submitMutation.isPending) return;
        submitMutation.mutate({ file, mode, ack });
    };

    const headingClass = "text-20 font-semibold text-ink outline-none";

    return (
        <div className="w-full p-5 lg:p-7">
            <section
                className="grid grid-cols-1 overflow-hidden rounded-panel border border-line bg-surface shadow-card md:grid-cols-[196px_minmax(0,1fr)]"
                aria-label="恢复流程"
            >
                <StepRail step={step} onGoto={gotoStep} />
                <div className="flex min-w-0 flex-col">
                    <div className="min-h-96 flex-1 px-6 py-7 sm:px-10 sm:py-9">
                        {step === 1 && (
                            <>
                                <h2 ref={headingRef} tabIndex={-1} className={headingClass}>
                                    选择备份文件
                                </h2>
                                {(localError || previewMutation.isError) && (
                                    <p
                                        role="alert"
                                        className="mt-4 flex items-start gap-2 rounded-card bg-danger-soft p-3.5 text-13 leading-relaxed text-danger-strong"
                                    >
                                        <Icon name="info" size={16} className="mt-0.5 shrink-0" />
                                        <span className="min-w-0">
                                            {localError ||
                                                `预检未通过：${previewMutation.error?.message || "文件不合法或与当前数据库结构不符"}。请更换文件。`}
                                        </span>
                                    </p>
                                )}
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".sql,.gz,application/sql,application/gzip"
                                    className="hidden"
                                    onChange={event => {
                                        acceptFile(event.target.files?.[0]);
                                        event.target.value = "";
                                    }}
                                />
                                {file === null ? (
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        aria-label="选择或拖放备份文件"
                                        onClick={() => fileInputRef.current?.click()}
                                        onKeyDown={event => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                fileInputRef.current?.click();
                                            }
                                        }}
                                        onDragOver={event => {
                                            if (!event.dataTransfer.types.includes("Files")) return;
                                            event.preventDefault();
                                            setDragOver(true);
                                        }}
                                        onDragLeave={event => {
                                            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                                setDragOver(false);
                                            }
                                        }}
                                        onDrop={event => {
                                            event.preventDefault();
                                            setDragOver(false);
                                            const dropped = event.dataTransfer.files;
                                            if (dropped.length !== 1) {
                                                setLocalError("每次请选择一份备份文件。");
                                                return;
                                            }
                                            acceptFile(dropped[0]);
                                        }}
                                        className={`group mt-5 flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-card border border-dashed px-4 py-7 text-center transition-colors ${
                                            dragOver
                                                ? "border-primary bg-primary-soft"
                                                : "border-line-strong bg-soft hover:border-primary-border"
                                        }`}
                                    >
                                        <span className="flex h-14 w-14 items-center justify-center rounded-xl border border-line bg-surface text-primary-strong shadow-xs">
                                            <Icon name="upload" size={26} />
                                        </span>
                                        <span className="mt-5 flex flex-wrap items-center justify-center gap-1.5 text-14 text-td">
                                            <span className="rounded-md px-2 py-0.5 text-15 font-semibold text-primary-strong underline-offset-2 group-hover:underline">
                                                选择文件
                                            </span>
                                            <span>或拖放文件到此处</span>
                                        </span>
                                        <p className="mt-2 text-12 text-muted">支持 .sql、.sql.gz，最大 512 MB</p>
                                    </div>
                                ) : (
                                    <div className="mt-5 flex items-center gap-3.5 rounded-card border border-line p-4">
                                        <span className="flex h-12 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-soft text-primary-strong">
                                            <Icon name="file" size={22} />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block break-all text-14 font-medium text-ink">
                                                {file.name}
                                            </span>
                                            <span className="mt-0.5 block text-12 tabular-nums text-muted">
                                                {formatFileSize(file.size)}
                                            </span>
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="shrink-0"
                                            aria-label="更换备份文件"
                                            onClick={() => fileInputRef.current?.click()}
                                        >
                                            更换
                                        </Button>
                                    </div>
                                )}
                                {file !== null && previewMutation.isPending && (
                                    <p
                                        role="status"
                                        className="mt-4 flex items-center gap-2 text-13 text-primary-strong"
                                    >
                                        <Icon
                                            name="refresh"
                                            size={16}
                                            className="animate-spin motion-reduce:animate-none"
                                        />
                                        正在检查文件…
                                    </p>
                                )}
                                {file !== null && preview !== null && (
                                    <p className="mt-4 flex items-center gap-2 text-13 text-success">
                                        <Icon name="check" size={16} />
                                        检查通过 · {formatDateTime(preview.meta.createdAt)} 备份
                                    </p>
                                )}
                            </>
                        )}
                        {step === 2 && (
                            <>
                                <h2 ref={headingRef} tabIndex={-1} className={headingClass}>
                                    选择恢复方式
                                </h2>
                                <p className="mt-3 flex items-center gap-2 text-12 text-muted">
                                    <Icon name="file" size={16} className="shrink-0" />
                                    <span className="break-all">{file?.name}</span>
                                </p>
                                <div
                                    className="mt-6 grid gap-3.5 2xl:grid-cols-2"
                                    role="radiogroup"
                                    aria-label="恢复方式"
                                >
                                    <ModeOption
                                        value="merge"
                                        title="补充缺失数据"
                                        tag="推荐"
                                        description="补回缺失的数据，已有数据保持不变；如遇冲突，整次操作回滚。"
                                        checked={mode === "merge"}
                                        onSelect={() => {
                                            setMode("merge");
                                            setAck("");
                                        }}
                                    />
                                    <ModeOption
                                        value="replace"
                                        title="恢复至备份状态"
                                        description={
                                            preview?.canReplace
                                                ? "以备份替换当前数据，备份之后的新增和修改将丢失，所有账号需重新登录。"
                                                : "此备份不完整，仅支持补充缺失数据。"
                                        }
                                        disabled={!preview?.canReplace}
                                        checked={mode === "replace"}
                                        onSelect={() => {
                                            setMode("replace");
                                            setAck("");
                                        }}
                                    />
                                </div>
                            </>
                        )}
                        {step === 3 && (
                            <>
                                <h2 ref={headingRef} tabIndex={-1} className={headingClass}>
                                    确认恢复
                                </h2>
                                <dl className="mt-4 border-b border-line pb-3">
                                    <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-5 py-2 sm:grid-cols-[88px_minmax(0,1fr)]">
                                        <dt className="text-13 text-muted">备份文件</dt>
                                        <dd className="min-w-0 text-14 break-all">
                                            {file?.name}
                                            {file && (
                                                <small className="mt-0.5 block text-12 text-muted">
                                                    {formatFileSize(file.size)}
                                                </small>
                                            )}
                                        </dd>
                                    </div>
                                    {preview && (
                                        <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-5 py-2 sm:grid-cols-[88px_minmax(0,1fr)]">
                                            <dt className="text-13 text-muted">备份时间</dt>
                                            <dd className="text-14">{formatDateTime(preview.meta.createdAt)}</dd>
                                        </div>
                                    )}
                                    <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-5 py-2 sm:grid-cols-[88px_minmax(0,1fr)]">
                                        <dt className="text-13 text-muted">恢复方式</dt>
                                        <dd className="text-14">{mode ? modeLabel(mode) : ""}</dd>
                                    </div>
                                </dl>
                                {mode === "replace" && (
                                    <div
                                        role="alert"
                                        className="mt-5 flex items-start gap-2.5 rounded-card bg-danger-soft p-3.5 text-13 leading-relaxed text-danger"
                                    >
                                        <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
                                        <p className="min-w-0">
                                            当前数据将被覆盖，备份之后的新增和修改会丢失。恢复完成后，所有账号需重新登录。
                                        </p>
                                    </div>
                                )}
                                <div className="mt-6">
                                    <label htmlFor="restore-ack" className="block text-13 text-td-strong">
                                        输入{" "}
                                        <code className="rounded bg-soft px-1.5 py-0.5 text-13 font-semibold text-ink">
                                            {expectedAck || "…"}
                                        </code>{" "}
                                        确认恢复
                                    </label>
                                    <input
                                        id="restore-ack"
                                        type="text"
                                        value={ack}
                                        onChange={event => setAck(event.target.value.trim())}
                                        onKeyDown={event => {
                                            if (event.key === "Enter" && canSubmit) start();
                                        }}
                                        autoComplete="off"
                                        spellCheck={false}
                                        aria-invalid={ack.length > 0 && ack !== expectedAck}
                                        aria-describedby={
                                            ack.length > 0 && ack !== expectedAck ? "restore-ack-hint" : undefined
                                        }
                                        className={`mt-2.5 block h-11 w-full max-w-90 rounded-input border bg-surface px-3.5 font-mono text-14 text-ink transition-colors outline-none ${
                                            ack.length === 0
                                                ? "border-line-strong"
                                                : ack === expectedAck
                                                  ? "border-success"
                                                  : "border-danger"
                                        }`}
                                    />
                                    <p
                                        id="restore-ack-hint"
                                        aria-live="polite"
                                        className="mt-1.5 min-h-5 text-12 text-danger"
                                    >
                                        {ack.length > 0 && ack !== expectedAck ? `请输入大写的 ${expectedAck}` : ""}
                                    </p>
                                </div>
                            </>
                        )}
                    </div>
                    <div className="flex min-h-[76px] flex-wrap items-center gap-3 border-t border-line px-6 py-4 sm:px-10">
                        {step > 1 && (
                            <Button
                                variant="secondary"
                                icon="chevron-left"
                                onClick={() => setStep(step === 3 ? 2 : 1)}
                                disabled={submitMutation.isPending}
                            >
                                上一步
                            </Button>
                        )}
                        <span className="ml-auto flex flex-wrap gap-3">
                            {step < 3 ? (
                                <Button disabled={step === 1 ? preview === null : mode === null} onClick={next}>
                                    下一步
                                    <Icon name="chevron-right" size={16} />
                                </Button>
                            ) : (
                                <Button
                                    variant={mode === "replace" ? "danger" : "primary"}
                                    disabled={!canSubmit}
                                    onClick={start}
                                >
                                    {submitMutation.isPending ? "正在提交任务…" : "开始恢复"}
                                </Button>
                            )}
                        </span>
                    </div>
                </div>
            </section>
        </div>
    );
}
