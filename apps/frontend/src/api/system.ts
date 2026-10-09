import type { BackupCatalog, BackupPreviewResult, RestoreJob, RestoreJobStatus, RestoreMode } from "./types";
import { requestClient } from "@/http";

/** 大文件上传/完整预检/流式下载的专用超时（nginx 层 1800s 对齐） */
const LONG_TIMEOUT = 600_000;

export function fetchBackupCatalog(): Promise<BackupCatalog> {
    return requestClient.get<BackupCatalog>("/system/backup/catalog");
}

/** 执行备份并下载（POST 流式）：responseReturn raw 取响应头里的文件名 */
export async function runBackup(groups: string[], gzip: boolean): Promise<{ fileName: string; data: Blob }> {
    const response = await requestClient.download<{ headers: Record<string, unknown>; data: Blob }>(
        "/system/backup/run",
        {
            method: "POST",
            data: { groups, gzip },
            responseReturn: "raw",
            responseType: "blob",
            timeout: LONG_TIMEOUT,
        },
    );
    const disposition = String(response.headers?.["content-disposition"] ?? "");
    const match = /filename="([^"]+)"/.exec(disposition);
    return { fileName: match?.[1] ?? `backup-${Date.now()}.sql${gzip ? ".gz" : ""}`, data: response.data };
}

/** 上传备份文件预检：校验格式/checksum/指纹并返回 meta（canReplace 标明可否整库还原） */
export function previewRestore(file: File): Promise<BackupPreviewResult> {
    const formData = new FormData();
    formData.append("file", file);
    return requestClient.post<BackupPreviewResult>("/system/restore/preview", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: LONG_TIMEOUT,
    });
}

export interface RunRestoreOutcome {
    jobId: string;
    status: RestoreJobStatus;
    job?: RestoreJob;
}

/**
 * 提交恢复（multipart：字段须在文件之前）。requestKey 为提交身份：断网/超时/401 后
 * 凭同一 key 查询或重提；服务端回放原终态或 409。
 */
export function runRestore(input: {
    file: File;
    mode: RestoreMode;
    ack: string;
    requestKey: string;
}): Promise<RunRestoreOutcome> {
    const formData = new FormData();
    formData.append("mode", input.mode);
    formData.append("ack", input.ack);
    formData.append("requestKey", input.requestKey);
    formData.append("file", input.file);
    return requestClient.post<RunRestoreOutcome>("/system/restore/run", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: LONG_TIMEOUT,
    });
}

/** 断线后凭客户端自存的 requestKey 查询（404 = 当前未查到记录，不代表终态） */
export function fetchRestoreJobByKey(requestKey: string): Promise<RestoreJob> {
    return requestClient.get<RestoreJob>(`/system/restore/jobs/key/${encodeURIComponent(requestKey)}`);
}
