/**
 * 应用内备份/恢复服务（实施计划 §3/§4/§5/§6 的编排层）。
 *
 * 备份：op_log(db_backup) 先记「发起备份」再开流（流式下载，快照与业务池隔离）。
 *
 * 恢复任务化与提交幂等：
 * - requestKey 为提交身份：已存在且摘要/模式相同 → 原终态 200；异文件/模式 → 409；
 * - 无行 → 完整预检 → 原子占用内存任务槽 → 零等待 GET_LOCK（专用连接）→ 锁内复查
 *   request_key → 建内存 RUNNING、接管文件、返 202；任务异步执行，不排队；
 * - 成功凭证与恢复数据同事务（引擎保证）；FAILED 行在确认未提交后单独补写；
 * - 维护态：激活 → 排空在途写（60s）→ 执行 → 结果确认后解除；UNKNOWN 保持维护并
 *   循环核实（新连接 + 同一恢复锁），数据库不可达时不自动重跑、不覆盖成功行；
 * - 临时文件服务自管：请求侧清理（preview/拒绝/中断），任务接管后 finally 清理，
 *   启动时清理上次崩溃遗留；
 * - 进程启动门禁：先短暂取得恢复锁再开放业务写与 purge；拿不到则保持维护态等待。
 */
import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    OnApplicationBootstrap,
    PayloadTooLargeException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import mariadb from "mariadb";
import type { AppConfig } from "../configuration";
import { PrismaService } from "../prisma/prisma.service";
import { createBackupConnection } from "../prisma/create-pool";
import { SnowflakeGenerator } from "../common/snowflake";
import { recordOpLog } from "../domain/op-log";
import { MaintenanceState } from "../domain/maintenance-state";
import type { AuthUser } from "../common/types/auth-user";
import { BACKUP_GROUPS } from "./backup.catalog";
import { restoreLockName } from "./restore-lock";
import { backupFileName, createBackupStream, type SqlStreamingExecutor } from "./engine/backup-writer";
import {
    BackupLimitError,
    executeRestore,
    insertCredentialRow,
    RestoreAbortedError,
    RestoreUnknownError,
    RestoreValidationError,
    toMariaDatetime,
    validateBackup,
    type RestoreCredential,
    type RestoreMode,
    type RestoreReport,
    type ValidatedBackup,
} from "./engine/restore-engine";

/** 上传文件（压缩态）上限 512MiB */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
/** 恢复前写请求排空时限 */
const DRAIN_TIMEOUT_MS = 60_000;
/** UNKNOWN 核实轮询间隔 */
const VERIFY_RETRY_MS = 5_000;
/** 内存任务记录上限（保留最近结果，超出淘汰最旧终态） */
const MEMORY_JOB_LIMIT = 50;

export type JobStatus = "RUNNING" | "UNKNOWN" | "SUCCEEDED" | "SUCCEEDED_AUDIT_FAILED" | "FAILED";

export interface JobView {
    jobId: string;
    requestKey: string;
    mode: "merge" | "replace";
    status: JobStatus;
    report: unknown;
    errorText: string;
    createdAt: string;
    finishedAt: string | null;
}

/** 内存任务记录：比视图多凭证字段（核实补写 FAILED 用），对外仅投影 JobView */
interface MemoryJob extends JobView {
    fileSha256: string;
    operatorId: bigint;
    operatorName: string;
}

export interface TempUpload {
    path: string;
    sha256: string;
    size: number;
}

export interface PreviewResult {
    meta: ValidatedBackup["meta"];
    canReplace: boolean;
    tables: ValidatedBackup["tables"];
}

type HandoffResult =
    | { kind: "accepted" }
    | { kind: "lock-conflict" }
    | { kind: "key-conflict" }
    | { kind: "existing"; job: JobView };

/** Fastify reply 的最小结构类型（仓库惯例：不直接依赖 fastify 包类型） */
interface ReplyLike {
    header(name: string, value: string): unknown;
    send(body: unknown): unknown;
    code(status: number): unknown;
    raw?: { once(event: string, listener: () => void): void; writableEnded?: boolean };
}

/** 等待流式响应真正 flush 到 socket（'finish' 或已结束） */
const waitForReplyFlush = async (reply: ReplyLike): Promise<void> => {
    const raw = reply.raw;
    if (!raw || raw.writableEnded === true) return;
    await new Promise<void>(resolve => {
        raw.once("finish", () => resolve());
        raw.once("close", () => resolve());
        raw.once("error", () => resolve());
    });
};

/** mariadb 专用连接 → 引擎执行器适配（一次性，不入池） */
class MariaDbExecutor implements SqlStreamingExecutor {
    constructor(private readonly connection: mariadb.Connection) {}

    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T> {
        if (params === undefined || params.length === 0) {
            return (await this.connection.query(sql)) as T;
        }
        return (await this.connection.query(sql, params)) as T;
    }

    queryStream<T = Record<string, unknown>>(sql: string): AsyncIterable<T> {
        return streamQueryRows<T>(this.connection, sql);
    }
}

/** mariadb queryStream（事件流）→ 异步迭代器 */
async function* streamQueryRows<T>(connection: mariadb.Connection, sql: string): AsyncGenerator<T> {
    const stream = connection.queryStream(sql) as unknown as {
        on(event: string, listener: (...args: never[]) => void): void;
        destroy?(): void;
    };
    const pending: T[] = [];
    let ended = false;
    let failure: unknown;
    let wake: (() => void) | undefined;
    stream.on("data", (row: never) => {
        pending.push(row as T);
        wake?.();
    });
    stream.on("end", () => {
        ended = true;
        wake?.();
    });
    stream.on("error", (error: unknown) => {
        failure = error;
        wake?.();
    });
    try {
        for (;;) {
            if (pending.length > 0) {
                yield pending.shift()!;
                continue;
            }
            if (failure !== undefined) {
                throw failure;
            }
            if (ended) {
                return;
            }
            await new Promise<void>(resolve => {
                wake = resolve;
            });
            wake = undefined;
        }
    } finally {
        stream.destroy?.();
    }
}

@Injectable()
export class SystemService implements OnApplicationBootstrap {
    private readonly logger = new Logger(SystemService.name);
    private readonly tempDir = join(tmpdir(), "zmsys-restore");
    private readonly database: string;
    private readonly restoreLockName: string;
    private slotBusy = false;
    private readonly memoryJobs = new Map<string, MemoryJob>();

    constructor(
        private readonly config: ConfigService<AppConfig>,
        private readonly prisma: PrismaService,
        private readonly snowflake: SnowflakeGenerator,
        private readonly maintenance: MaintenanceState,
    ) {
        this.database = this.config.getOrThrow("database.name", { infer: true });
        this.restoreLockName = restoreLockName(this.database);
    }

    /* ---------------------------------------------------------------- */
    /* 启动门禁                                                          */
    /* ---------------------------------------------------------------- */

    /** 进程启动先短暂取得恢复锁再开放业务写；拿不到则保持维护态后台等待旧会话结束 */
    async onApplicationBootstrap(): Promise<void> {
        await mkdir(this.tempDir, { recursive: true });
        const opened = await this.tryStartupGate();
        if (!opened) {
            this.maintenance.activate();
            this.logger.warn("启动门禁未取得恢复锁，进入维护态等待旧恢复会话结束");
            void this.startupGateRetryLoop();
        }
    }

    private async tryStartupGate(): Promise<boolean> {
        let connection: mariadb.Connection | null = null;
        try {
            connection = await this.createConnection();
            const locked = await this.acquireRestoreLock(connection, 5);
            if (locked) {
                await this.releaseRestoreLock(connection);
                await this.cleanupStaleTempFiles();
                return true;
            }
            return false;
        } catch (error) {
            this.logger.error(`启动门禁失败（保持维护态重试）：${String(error)}`);
            return false;
        } finally {
            await this.endConnection(connection);
        }
    }

    private async startupGateRetryLoop(): Promise<void> {
        for (;;) {
            await new Promise(resolve => setTimeout(resolve, VERIFY_RETRY_MS));
            if (await this.tryStartupGate()) {
                this.maintenance.deactivate();
                this.logger.log("启动门禁通过，恢复业务写入");
                return;
            }
        }
    }

    private async cleanupStaleTempFiles(): Promise<void> {
        try {
            await rm(this.tempDir, { recursive: true, force: true });
            await mkdir(this.tempDir, { recursive: true });
        } catch (error) {
            this.logger.warn(`清理遗留临时文件失败：${String(error)}`);
        }
    }

    /* ---------------------------------------------------------------- */
    /* 目录                                                              */
    /* ---------------------------------------------------------------- */

    getBackupCatalog(): { groups: typeof BACKUP_GROUPS; allGroupKeys: string[] } {
        return { groups: BACKUP_GROUPS, allGroupKeys: BACKUP_GROUPS.map(group => group.key) };
    }

    /* ---------------------------------------------------------------- */
    /* 备份                                                              */
    /* ---------------------------------------------------------------- */

    /** 流式备份下载：op_log(db_backup) 先行（发起记录，不当下载成功凭证），随后开流（快照含本审计行） */
    async runBackup(groups: string[], gzip: boolean, actor: AuthUser, reply: ReplyLike): Promise<void> {
        let connection: mariadb.Connection | null = null;
        try {
            connection = await this.createConnection();
            const executor = new MariaDbExecutor(connection);
            const fileName = backupFileName(this.database, groups, gzip);
            // 发起审计先行；快照随后建立，备份会包含本行（幂等 merge 时按内容一致跳过）
            await this.recordBackupAudit(actor, fileName, groups, gzip);
            const handle = await createBackupStream({ executor, database: this.database, groups, gzip, fileName });
            reply.code(200);
            reply.header("content-type", gzip ? "application/gzip" : "application/sql; charset=utf-8");
            reply.header("content-disposition", `attachment; filename="${handle.fileName}"`);
            reply.header("cache-control", "no-store");
            reply.send(handle.stream);
            try {
                // 等待流真正排空后再释放连接（维护排空会把本请求计入等待）
                await handle.done;
            } catch (error) {
                // 流已终止：不向 SQL 尾部混入错误信封，仅记录
                this.logger.error(`备份流中断：${String(error)}`);
            }
            // 流数据写完 ≠ 响应已 flush：等待 socket 层完成，避免 Nest 在
            // handler 返回时用默认状态码/信封覆盖流式响应
            await waitForReplyFlush(reply);
        } finally {
            await this.endConnection(connection);
        }
    }

    private async recordBackupAudit(actor: AuthUser, fileName: string, groups: string[], gzip: boolean): Promise<void> {
        const now = new Date();
        await this.prisma.$transaction(tx =>
            recordOpLog(tx, this.snowflake, actor, {
                action: "db_backup",
                targetType: "backup",
                targetId: 0n,
                targetCode: fileName,
                detail: { groups, gzip, fileName },
                now,
            }),
        );
    }

    /* ---------------------------------------------------------------- */
    /* 上传暂存                                                          */
    /* ---------------------------------------------------------------- */

    /** multipart 文件流 → 服务自管临时文件（限 512MiB，超限 413；同时计算 sha256） */
    async saveUpload(stream: Readable): Promise<TempUpload> {
        await mkdir(this.tempDir, { recursive: true });
        const path = join(this.tempDir, `upload-${randomUUID()}.part`);
        const hash = createHash("sha256");
        let size = 0;
        try {
            await pipeline(
                stream,
                // 计数/摘要的透传 Transform（pipeline 中间流必须是 Duplex/Transform）
                new Transform({
                    transform: (chunk: Buffer, _encoding, callback) => {
                        size += chunk.length;
                        if (size > MAX_UPLOAD_BYTES) {
                            callback(new PayloadTooLargeException("上传文件超过 512MiB 上限"));
                            return;
                        }
                        hash.update(chunk);
                        callback(null, chunk);
                    },
                }),
                createWriteStream(path),
            );
        } catch (error) {
            await unlink(path).catch(() => undefined);
            throw error;
        }
        return { path, sha256: hash.digest("hex"), size };
    }

    private openTempStream(temp: TempUpload): () => Readable {
        return () => createReadStream(temp.path);
    }

    /* ---------------------------------------------------------------- */
    /* 预检（preview）                                                   */
    /* ---------------------------------------------------------------- */

    async previewRestore(temp: TempUpload): Promise<PreviewResult> {
        let connection: mariadb.Connection | null = null;
        try {
            connection = await this.createConnection();
            const executor = new MariaDbExecutor(connection);
            const validated = await validateBackup(executor, this.database, this.openTempStream(temp), "merge");
            return { meta: validated.meta, canReplace: validated.fullBackup, tables: validated.tables };
        } catch (error) {
            throw mapValidationError(error);
        } finally {
            await this.endConnection(connection);
            await unlink(temp.path).catch(() => undefined);
        }
    }

    /* ---------------------------------------------------------------- */
    /* 恢复执行（run）                                                   */
    /* ---------------------------------------------------------------- */

    /**
     * 提交恢复：requestKey 去重 → 完整预检 → 任务槽 + 零等待恢复锁 → 锁内复查 →
     * 202（任务接管文件异步执行）。已存在同 key 同文件/模式 → 返回原终态。
     */
    async runRestore(
        temp: TempUpload,
        mode: string,
        ack: string,
        requestKey: string,
        actor: AuthUser,
    ): Promise<{ jobId: string; existing?: JobView }> {
        if (mode !== "merge" && mode !== "replace") {
            throw new BadRequestException("mode 必须是 merge 或 replace");
        }
        const expectedAck = mode === "merge" ? "RESTORE" : "REPLACE";
        if (ack !== expectedAck) {
            throw new BadRequestException(`确认口令不正确（${mode} 模式须输入 ${expectedAck}）`);
        }
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/.test(requestKey)) {
            throw new BadRequestException("requestKey 须为 8-64 位字母数字与 ._-= 字符");
        }

        // 幂等复查：已有持久终态行——同文件同模式回放原终态（200），否则 409。
        // 查询本身抛错（DB 故障）也属请求侧失败：清理临时文件后原样上抛（5xx）
        let existingRow;
        try {
            existingRow = await this.prisma.sysRestoreJob.findUnique({ where: { requestKey } });
        } catch (error) {
            await unlink(temp.path).catch(() => undefined);
            throw error;
        }
        if (existingRow) {
            await unlink(temp.path).catch(() => undefined);
            if (existingRow.fileSha256 === temp.sha256 && existingRow.mode === mode) {
                return { jobId: existingRow.id.toString(), existing: jobViewFromRow(existingRow) };
            }
            throw new ConflictException("该 requestKey 已用于其他文件或模式，须更换 requestKey");
        }

        // 完整预检（校验实际提交文件，不信任 preview 结果）
        {
            let connection: mariadb.Connection | null = null;
            try {
                connection = await this.createConnection();
                const executor = new MariaDbExecutor(connection);
                await validateBackup(executor, this.database, this.openTempStream(temp), mode as RestoreMode);
            } catch (error) {
                await unlink(temp.path).catch(() => undefined);
                throw mapValidationError(error);
            } finally {
                await this.endConnection(connection);
            }
        }

        if (this.slotBusy) {
            await unlink(temp.path).catch(() => undefined);
            throw new ConflictException("已有恢复任务在执行，请稍后重试（不排队）");
        }
        this.slotBusy = true;

        const jobId = this.snowflake.next();
        let settleHandoff: (result: HandoffResult) => void = () => undefined;
        let failHandoff: (error: unknown) => void = () => undefined;
        const handoff = new Promise<HandoffResult>((resolve, reject) => {
            settleHandoff = resolve;
            failHandoff = reject;
        });
        // 任务立即启动（建连/加锁/锁内复查），完成接管判定后才返回 202
        void this.executeRestoreTask({
            temp,
            mode: mode as RestoreMode,
            requestKey,
            jobId,
            actor,
            settle: settleHandoff,
            fail: failHandoff,
        });

        const decision = await handoff;
        if (decision.kind === "lock-conflict") {
            throw new ConflictException("恢复锁被占用（另一恢复会话仍在收尾），请稍后重试");
        }
        if (decision.kind === "key-conflict") {
            throw new ConflictException("该 requestKey 已用于其他文件或模式，须更换 requestKey");
        }
        if (decision.kind === "existing") {
            return { jobId: decision.job.jobId, existing: decision.job };
        }
        return { jobId: jobId.toString() };
    }

    /* ---------------------------------------------------------------- */
    /* 恢复任务（异步）                                                  */
    /* ---------------------------------------------------------------- */

    private async executeRestoreTask(params: {
        temp: TempUpload;
        mode: RestoreMode;
        requestKey: string;
        jobId: bigint;
        actor: AuthUser;
        settle: (result: HandoffResult) => void;
        fail: (error: unknown) => void;
    }): Promise<void> {
        const { temp, mode, requestKey, jobId, actor, settle, fail } = params;
        const memoryJob: MemoryJob = {
            jobId: jobId.toString(),
            requestKey,
            mode,
            status: "RUNNING",
            report: null,
            errorText: "",
            createdAt: new Date().toISOString(),
            finishedAt: null,
            fileSha256: temp.sha256,
            operatorId: BigInt(actor.id),
            operatorName: actor.name,
        };
        let connection: mariadb.Connection | null = null;
        let lockHeld = false;
        let maintenanceActivated = false;
        let pendingUnknown = false;
        try {
            try {
                connection = await this.createConnection();
            } catch (error) {
                fail(error);
                return;
            }
            let locked: boolean;
            try {
                locked = await this.acquireRestoreLock(connection, 0);
            } catch (error) {
                fail(error);
                return;
            }
            if (!locked) {
                settle({ kind: "lock-conflict" });
                return;
            }
            lockHeld = true;

            // 锁内复查：另一请求可能在预检期间完成同 key 提交。
            // 与首次查询同口径比对摘要与模式：同文件同模式回放原终态，否则 409（提交身份契约）
            const existingRow = await this.prisma.sysRestoreJob.findUnique({ where: { requestKey } });
            if (existingRow) {
                if (existingRow.fileSha256 === temp.sha256 && existingRow.mode === mode) {
                    settle({ kind: "existing", job: jobViewFromRow(existingRow) });
                } else {
                    settle({ kind: "key-conflict" });
                }
                return;
            }

            this.memoryJobs.set(requestKey, memoryJob);
            settle({ kind: "accepted" });

            // —— 以下为接管后的异步执行 ——
            this.maintenance.activate();
            maintenanceActivated = true;
            this.logger.log(`恢复任务接管（requestKey=${requestKey}，mode=${mode}），维护态已激活`);

            const drained = await this.maintenance.drain(DRAIN_TIMEOUT_MS);
            if (!drained) {
                throw new RestoreAbortedError("维护排空超时（在途写请求未结束），恢复未执行", { stage: "drain" });
            }
            this.logger.log(`维护排空完成（requestKey=${requestKey}），开始执行恢复`);

            const executor = new MariaDbExecutor(connection);
            const credential: RestoreCredential = {
                jobId,
                requestKey,
                fileSha256: temp.sha256,
                mode,
                operatorId: BigInt(actor.id),
                operatorName: actor.name,
            };
            const report = await executeRestore(
                { executor, database: this.database, mode, credential },
                this.openTempStream(temp),
            );

            memoryJob.report = report;
            memoryJob.status = "SUCCEEDED";
            memoryJob.finishedAt = new Date().toISOString();
            this.logger.log(`恢复成功（requestKey=${requestKey}）`);

            // 审计（尽力而为）：失败把凭证标 SUCCEEDED_AUDIT_FAILED，不把已提交恢复报成失败
            try {
                await this.recordRestoreAudit(actor, report, requestKey);
            } catch (auditError) {
                this.logger.error(`恢复审计写入失败：${String(auditError)}`);
                try {
                    await this.prisma.sysRestoreJob.update({
                        where: { requestKey },
                        data: { status: "SUCCEEDED_AUDIT_FAILED" },
                    });
                    memoryJob.status = "SUCCEEDED_AUDIT_FAILED";
                } catch (markError) {
                    this.logger.error(`凭证标记 SUCCEEDED_AUDIT_FAILED 失败（保留成功凭证）：${String(markError)}`);
                }
            }
        } catch (error) {
            if (error instanceof RestoreUnknownError) {
                memoryJob.status = "UNKNOWN";
                memoryJob.errorText = "提交结果未知，正在核实（保持维护态，禁止自动重跑）";
                pendingUnknown = true;
                this.logger.error(`恢复结果未知（requestKey=${requestKey}）：${String(error)}`);
            } else {
                const message = error instanceof Error ? error.message : String(error);
                memoryJob.status = "FAILED";
                memoryJob.errorText = message;
                memoryJob.finishedAt = new Date().toISOString();
                // 确定性失败：尽力补写 FAILED 凭证（确认未提交后单独写）
                await this.writeFailedCredential(connection, lockHeld, memoryJob, message).catch(markError => {
                    this.logger.error(`FAILED 凭证写入失败：${String(markError)}`);
                });
                this.logger.warn(`恢复失败（requestKey=${requestKey}）：${message}`);
            }
        } finally {
            if (lockHeld && connection) {
                await this.releaseRestoreLock(connection).catch(() => undefined);
            }
            await this.endConnection(connection);
            await unlink(temp.path).catch(() => undefined);
            this.slotBusy = false;
            this.trimMemoryJobs();
        }

        if (pendingUnknown) {
            // UNKNOWN：保持维护态，循环核实直到取得锁并确认终态
            await this.verifyUnknownAndFinalize(memoryJob);
        } else if (maintenanceActivated) {
            this.maintenance.deactivate();
            this.logger.log(`维护态解除（requestKey=${requestKey}，终态=${memoryJob.status}）`);
        }
    }

    /** UNKNOWN 核实：新连接取得同一恢复锁 → 有成功行即成功；锁在手且无行 → 记 FAILED */
    private async verifyUnknownAndFinalize(job: MemoryJob): Promise<void> {
        for (;;) {
            let connection: mariadb.Connection | null = null;
            try {
                connection = await this.createConnection();
                const locked = await this.acquireRestoreLock(connection, 0);
                if (!locked) {
                    await this.endConnection(connection);
                    await new Promise(resolve => setTimeout(resolve, VERIFY_RETRY_MS));
                    continue;
                }
                try {
                    const rows = (await connection.query(
                        "SELECT status, report_json, error_text, finished_at FROM sys_restore_job WHERE request_key = ?",
                        [job.requestKey],
                    )) as Array<{ status: JobStatus; report_json: unknown; error_text: string; finished_at: string }>;
                    if (rows.length > 0) {
                        job.status = rows[0].status;
                        job.report = rows[0].report_json;
                        job.errorText = rows[0].error_text;
                        job.finishedAt = toIso(rows[0].finished_at);
                        this.logger.log(`UNKNOWN 核实完成（requestKey=${job.requestKey}）：${job.status}`);
                    } else {
                        // 锁在手（旧会话已结束）且无成功凭证 ⇒ 确认未提交
                        const now = new Date();
                        await connection.query(
                            `INSERT INTO sys_restore_job
                                 (id, request_key, file_sha256, mode, status, operator_id, operator_name, report_json, error_text, created_at, finished_at)
                             VALUES (?, ?, ?, ?, 'FAILED', ?, ?, ?, ?, ?, ?)`,
                            [
                                this.snowflake.next(),
                                job.requestKey,
                                job.fileSha256,
                                job.mode,
                                job.operatorId,
                                job.operatorName,
                                JSON.stringify({ mode: job.mode, verified: "no-success-credential" }),
                                "提交结果未知，但已确认旧会话结束且无成功凭证，判定为未提交",
                                toMariaDatetime(new Date(job.createdAt)),
                                toMariaDatetime(now),
                            ],
                        );
                        job.status = "FAILED";
                        job.errorText = "提交结果未知，核实后确认未提交";
                        job.finishedAt = now.toISOString();
                        this.logger.warn(`UNKNOWN 核实完成（requestKey=${job.requestKey}）：无成功凭证，记 FAILED`);
                    }
                    this.maintenance.deactivate();
                    return;
                } finally {
                    await this.releaseRestoreLock(connection).catch(() => undefined);
                }
            } catch (error) {
                this.logger.error(`UNKNOWN 核实失败（保持维护态继续）：${String(error)}`);
                if (connection) {
                    try {
                        await connection.end();
                    } catch {
                        try {
                            connection.destroy();
                        } catch {
                            /* 已断开 */
                        }
                    }
                }
                await new Promise(resolve => setTimeout(resolve, VERIFY_RETRY_MS));
            }
        }
    }

    /* ---------------------------------------------------------------- */
    /* 任务查询                                                          */
    /* ---------------------------------------------------------------- */

    async getJobById(id: string): Promise<JobView | null> {
        if (!/^\d{1,19}$/.test(id)) {
            return null;
        }
        for (const job of this.memoryJobs.values()) {
            if (job.jobId === id) {
                return toJobView(job);
            }
        }
        const row = await this.prisma.sysRestoreJob.findUnique({ where: { id: BigInt(id) } });
        return row ? jobViewFromRow(row) : null;
    }

    async getJobByKey(requestKey: string): Promise<JobView | null> {
        const memory = this.memoryJobs.get(requestKey);
        if (memory) {
            return toJobView(memory);
        }
        const row = await this.prisma.sysRestoreJob.findUnique({ where: { requestKey } });
        return row ? jobViewFromRow(row) : null;
    }

    /* ---------------------------------------------------------------- */
    /* 内部工具                                                          */
    /* ---------------------------------------------------------------- */

    private async createConnection(): Promise<mariadb.Connection> {
        return createBackupConnection({
            host: this.config.getOrThrow("database.host", { infer: true }),
            port: this.config.getOrThrow("database.port", { infer: true }),
            user: this.config.getOrThrow("database.user", { infer: true }),
            password: this.config.getOrThrow("database.password", { infer: true }),
            name: this.database,
        });
    }

    private async acquireRestoreLock(connection: mariadb.Connection, waitSeconds: number): Promise<boolean> {
        const rows = (await connection.query("SELECT GET_LOCK(?, ?) AS locked", [
            this.restoreLockName,
            waitSeconds,
        ])) as Array<{ locked: number | bigint | null }>;
        // prepared 路径下 GET_LOCK 标量可能返回 BigInt：统一数值化后再比较
        return Number(rows[0]?.locked) === 1;
    }

    private async releaseRestoreLock(connection: mariadb.Connection): Promise<void> {
        await connection.query("SELECT RELEASE_LOCK(?)", [this.restoreLockName]);
    }

    private async endConnection(connection: mariadb.Connection | null): Promise<void> {
        if (!connection) return;
        try {
            await connection.end();
        } catch {
            // 正常收尾失败则强制销毁：会话锁随连接终止释放（destroy 为同步 void）
            try {
                connection.destroy();
            } catch {
                /* 已断开 */
            }
        }
    }

    private async writeFailedCredential(
        connection: mariadb.Connection | null,
        lockHeld: boolean,
        job: MemoryJob,
        message: string,
    ): Promise<void> {
        if (!connection || !lockHeld) return;
        const report: RestoreReport = {
            mode: job.mode,
            startedAt: job.createdAt,
            finishedAt: new Date().toISOString(),
            tables: [],
            tokenVersionsRaised: 0,
            apiIdempotencyPurged: 0,
        };
        const credential: RestoreCredential = {
            jobId: BigInt(job.jobId),
            requestKey: job.requestKey,
            fileSha256: job.fileSha256,
            mode: job.mode,
            operatorId: job.operatorId,
            operatorName: job.operatorName,
        };
        await insertCredentialRow(
            new MariaDbExecutor(connection),
            credential,
            "FAILED",
            report,
            message,
            new Date(job.createdAt),
            new Date(),
        );
    }

    private async recordRestoreAudit(actor: AuthUser, report: RestoreReport, requestKey: string): Promise<void> {
        const inserted = report.tables.reduce((sum, table) => sum + table.inserted, 0);
        const skipped = report.tables.reduce((sum, table) => sum + table.skipped, 0);
        const now = new Date();
        await this.prisma.$transaction(tx =>
            recordOpLog(tx, this.snowflake, actor, {
                action: "db_restore",
                targetType: "restore",
                targetId: 0n,
                targetCode: requestKey,
                detail: {
                    mode: report.mode,
                    tables: report.tables.length,
                    inserted,
                    skipped,
                    tokenVersionsRaised: report.tokenVersionsRaised,
                },
                now,
            }),
        );
    }

    private trimMemoryJobs(): void {
        if (this.memoryJobs.size <= MEMORY_JOB_LIMIT) return;
        const terminal: MemoryJob[] = [];
        for (const job of this.memoryJobs.values()) {
            if (job.status !== "RUNNING" && job.status !== "UNKNOWN") {
                terminal.push(job);
            }
        }
        const excess = this.memoryJobs.size - MEMORY_JOB_LIMIT;
        for (let i = 0; i < Math.min(excess, terminal.length); i += 1) {
            this.memoryJobs.delete(terminal[i].requestKey);
        }
    }
}

/* ------------------------------------------------------------------ */
/* 映射工具                                                            */
/* ------------------------------------------------------------------ */

const toJobView = (job: MemoryJob): JobView => ({
    jobId: job.jobId,
    requestKey: job.requestKey,
    mode: job.mode,
    status: job.status,
    report: job.report,
    errorText: job.errorText,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
});

interface SysRestoreJobRow {
    id: bigint;
    requestKey: string;
    mode: "merge" | "replace";
    status: "SUCCEEDED" | "SUCCEEDED_AUDIT_FAILED" | "FAILED";
    reportJson: unknown;
    errorText: string;
    createdAt: Date;
    finishedAt: Date;
}

const jobViewFromRow = (row: SysRestoreJobRow): JobView => ({
    jobId: row.id.toString(),
    requestKey: row.requestKey,
    mode: row.mode,
    status: row.status,
    report: row.reportJson,
    errorText: row.errorText,
    createdAt: toIso(row.createdAt),
    finishedAt: toIso(row.finishedAt),
});

/** DATETIME(3) 原文（dateStrings）→ ISO；无效值返回原文 */
const toIso = (value: Date | string): string => {
    if (value instanceof Date) {
        return value.toISOString();
    }
    const parsed = new Date(`${value.replace(" ", "T")}Z`);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
};

/** 校验类错误 → 4xx/413；其余原样上抛（5xx） */
const mapValidationError = (error: unknown): unknown => {
    if (error instanceof RestoreValidationError) {
        return new BadRequestException(error.message);
    }
    if (error instanceof BackupLimitError) {
        return new PayloadTooLargeException(error.message);
    }
    return error;
};
