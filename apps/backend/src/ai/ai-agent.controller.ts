/**
 * AI agent 数据端点（契约 /ai/agent/*）：面向「众茂AI」助手的只读查询与按需文档。
 * - 文档：登录即可读（内容为业务说明与操作口径，不含敏感数据）；
 * - 作废/删除查询沿用各域既有权限码——agent 与登录用户同权，能看到的一定是
 *   本人本来就能看到的；system-logs:view 为普通可授权码（默认仅超管持有，
 *   超管可在「角色与权限」直接授予）；
 * - 全业务数据查询不在本控制器：GET /workbench/overview 与 GET /workbench/relations
 *   （openapi 已声明 agent 共用）及各域列表、GET /system-logs（操作历史）直接复用，
 *   详见 docs/ai/endpoints.md。
 */
import { Controller, Get, Param, Query } from "@nestjs/common";
import { AuthenticatedOnly } from "../common/decorators/authenticated-only.decorator";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PERMISSIONS } from "../constants";
import { AiAgentService } from "./ai-agent.service";
import { AiDocsService } from "./ai-docs.service";
import { AgentDeletedQueryDto } from "./dto/agent-deleted-query.dto";
import { VoidedInboundQueryDto, VoidedOutboundQueryDto } from "./dto/agent-voided-query.dto";

@Controller("ai/agent")
export class AiAgentController {
    constructor(
        private readonly agentService: AiAgentService,
        private readonly docsService: AiDocsService,
    ) {}

    @Get("docs")
    @AuthenticatedOnly()
    async getDocs() {
        return this.docsService.getManifest();
    }

    @Get("docs/:topicId")
    @AuthenticatedOnly()
    async getDocTopic(@Param("topicId") topicId: string) {
        return this.docsService.getTopic(topicId);
    }

    @Get("voided/inbound")
    @Permissions([PERMISSIONS.INBOUND_VIEW], "无权查看作废入库数据")
    async listVoidedInbound(@Query() query: VoidedInboundQueryDto) {
        return this.agentService.listVoidedInbound(query);
    }

    @Get("voided/outbound")
    @Permissions([PERMISSIONS.OUTBOUND_VIEW], "无权查看作废出库数据")
    async listVoidedOutbound(@Query() query: VoidedOutboundQueryDto) {
        return this.agentService.listVoidedOutbound(query);
    }

    @Get("deleted")
    @Permissions([PERMISSIONS.SYSTEM_LOGS_VIEW], "无权查看删除审计")
    async listDeleted(@Query() query: AgentDeletedQueryDto) {
        return this.agentService.listDeleted(query);
    }
}
