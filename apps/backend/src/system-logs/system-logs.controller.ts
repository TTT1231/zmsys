import { Controller, Get, Query } from "@nestjs/common";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PERMISSIONS } from "../constants";
import { SystemLogsService } from "./system-logs.service";
import { SystemLogsQueryDto } from "./system-logs-query.dto";
import type { SystemLogPage } from "./types";

/** 系统日志（openapi system-logs tag）：聚合 op_log 与各业务变更日志的时间线；
 * 受保护动作仅超级管理员（不用 @AuthenticatedOnly——那会让所有登录用户绕过
 * 菜单可见性直接调 API） */
@Controller("system-logs")
export class SystemLogsController {
    constructor(private readonly systemLogs: SystemLogsService) {}

    @Get()
    @Permissions([PERMISSIONS.SYSTEM_LOGS_VIEW], "仅超级管理员可查看系统日志")
    listLogs(@Query() query: SystemLogsQueryDto): Promise<SystemLogPage> {
        return this.systemLogs.listLogs(query);
    }
}
