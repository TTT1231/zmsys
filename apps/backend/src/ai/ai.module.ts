import { Module } from "@nestjs/common";
import { AiAdminController } from "./ai-admin.controller";
import { AiAdminService } from "./ai-admin.service";
import { AiAgentController } from "./ai-agent.controller";
import { AiAgentService } from "./ai-agent.service";
import { AiChatController } from "./ai-chat.controller";
import { AiChatService } from "./ai-chat.service";
import { AiDocsService } from "./ai-docs.service";

/** AI 助手模块：agent 查询/文档、对话代理（后端转发+按人记账）、AI 工作台管理。
 *  Prisma/Snowflake 均为 @Global 模块，无需显式导入。 */
@Module({
    controllers: [AiAgentController, AiChatController, AiAdminController],
    providers: [AiDocsService, AiAgentService, AiChatService, AiAdminService],
})
export class AiModule {}
