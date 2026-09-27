/**
 * 系统备份/恢复端点：全部端点检查受保护的执行权限，
 * 包括目录、预检和任务查询；前端 onlyFor 仅控制展示。
 *
 * - POST system/backup/run：流式下载（@Res + reply.send），先写「发起备份」op_log；
 * - POST system/restore/preview|run：multipart（mode + ack + requestKey + file），
 *   字段须置于文件之前（@fastify/multipart 的 file.fields 只含先于文件出现的字段）；
 * - GET system/restore/jobs/key/:requestKey：断线后凭客户端自存 key 查询（维护期放行）。
 */
import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    NotFoundException,
    Param,
    Post,
    Req,
    Res,
} from "@nestjs/common";
import { Readable } from "node:stream";
import { unlink } from "node:fs/promises";
import { SystemService, type JobStatus, type JobView, type TempUpload } from "./system.service";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PERMISSIONS } from "../constants";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { BackupRunDto } from "./dto/backup-run.dto";
import type { AuthUser } from "../common/types/auth-user";

/** Fastify reply/request 的最小结构类型（仓库惯例：不直接依赖 fastify 包类型） */
interface ReplyLike {
    header(name: string, value: string): unknown;
    send(body: unknown): unknown;
    code(status: number): unknown;
}

interface RequestLike {
    method?: string;
    url?: string;
    file?: () => Promise<FileWithFields | undefined>;
}

interface MultipartFieldLike {
    value?: unknown;
}

interface FileWithFields {
    file: NodeJS.ReadableStream;
    fields: Record<string, MultipartFieldLike | string>;
    filename: string;
    mimetype: string;
}

const readField = (fields: Record<string, MultipartFieldLike | string>, name: string): string | undefined => {
    const value = fields[name];
    if (value === undefined) return undefined;
    if (typeof value === "string") return value;
    return typeof value.value === "string" ? value.value : undefined;
};

const NOT_FOUND_MESSAGE =
    "未查到该恢复任务（当前无持久记录不代表终态：原请求可能仍在上传或预检）。请保留 requestKey 稍后重查，或以同文件/模式/requestKey 重新提交";

@Controller("system")
export class SystemController {
    constructor(private readonly systemService: SystemService) {}

    @Get("backup/catalog")
    @Permissions([PERMISSIONS.SYSTEM_BACKUP_RUN], "无权查看备份目录")
    async getCatalog() {
        return this.systemService.getBackupCatalog();
    }

    @Post("backup/run")
    @Permissions([PERMISSIONS.SYSTEM_BACKUP_RUN], "无权执行备份")
    @HttpCode(HttpStatus.OK)
    async runBackup(@Body() dto: BackupRunDto, @CurrentUser() actor: AuthUser, @Res() reply: ReplyLike): Promise<void> {
        await this.systemService.runBackup(dto.groups, dto.gzip ?? false, actor, reply);
    }

    @Post("restore/preview")
    @Permissions([PERMISSIONS.SYSTEM_RESTORE_RUN], "无权预检恢复文件")
    @HttpCode(HttpStatus.OK)
    async previewRestore(@Req() request: RequestLike) {
        const { temp } = await this.consumeUpload(request);
        return this.systemService.previewRestore(temp);
    }

    @Post("restore/run")
    @Permissions([PERMISSIONS.SYSTEM_RESTORE_RUN], "无权执行恢复")
    async runRestore(
        @Req() request: RequestLike,
        @CurrentUser() actor: AuthUser,
        @Res({ passthrough: true }) reply: ReplyLike,
    ): Promise<{ jobId: string; status: JobStatus; job?: JobView }> {
        const { temp, fields } = await this.consumeUpload(request);
        const mode = readField(fields, "mode");
        const ack = readField(fields, "ack");
        const requestKey = readField(fields, "requestKey");
        if (mode === undefined || ack === undefined || requestKey === undefined) {
            await unlink(temp.path).catch(() => undefined);
            throw new BadRequestException("multipart 缺少 mode / ack / requestKey 字段（字段须置于文件之前）");
        }
        const result = await this.systemService.runRestore(temp, mode, ack, requestKey, actor);
        if (result.existing) {
            reply.code(HttpStatus.OK);
            return { jobId: result.jobId, status: result.existing.status, job: result.existing };
        }
        reply.code(HttpStatus.ACCEPTED);
        return { jobId: result.jobId, status: "RUNNING" };
    }

    @Get("restore/jobs/key/:requestKey")
    @Permissions([PERMISSIONS.SYSTEM_RESTORE_RUN], "无权查询恢复任务")
    async getJobByKey(@Param("requestKey") requestKey: string) {
        const job = await this.systemService.getJobByKey(requestKey);
        if (!job) {
            throw new NotFoundException(NOT_FOUND_MESSAGE);
        }
        return job;
    }

    @Get("restore/jobs/:id")
    @Permissions([PERMISSIONS.SYSTEM_RESTORE_RUN], "无权查询恢复任务")
    async getJobById(@Param("id") id: string) {
        const job = await this.systemService.getJobById(id);
        if (!job) {
            throw new NotFoundException(NOT_FOUND_MESSAGE);
        }
        return job;
    }

    /** 消费 multipart 文件部分 → 服务自管临时文件（流式落盘 + sha256 + 512MiB 上限） */
    private async consumeUpload(request: RequestLike): Promise<{
        temp: TempUpload;
        fields: Record<string, MultipartFieldLike | string>;
    }> {
        if (typeof request.file !== "function") {
            throw new BadRequestException("请求必须是 multipart/form-data");
        }
        const part = await request.file();
        if (!part) {
            throw new BadRequestException("缺少上传文件");
        }
        const temp = await this.systemService.saveUpload(Readable.from(part.file as never));
        return { temp, fields: part.fields };
    }
}
