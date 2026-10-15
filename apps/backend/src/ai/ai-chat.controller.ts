/**
 * AI 对话代理端点（契约 /ai/chat*）：登录即可对话，按登录人记账 token。
 * - POST /ai/chat：非流式，正常 {code,data,message} 信封；
 * - POST /ai/chat/stream：SSE 直通上游（@Res 手动收尾，同 system/backup/run 先例，
 *   不走信封拦截器——单端点双模式有二次发送风险，故拆两个端点）。
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import { AuthenticatedOnly } from "../common/decorators/authenticated-only.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types/auth-user";
import { AiChatService, type SseReplyLike, type StreamRequestLike } from "./ai-chat.service";
import { ChatRequestDto } from "./dto/chat.dto";

@Controller("ai")
export class AiChatController {
    constructor(private readonly chatService: AiChatService) {}

    @Get("status")
    @AuthenticatedOnly()
    async status() {
        return this.chatService.status();
    }

    @Post("chat")
    @AuthenticatedOnly()
    @HttpCode(HttpStatus.OK)
    async chat(@Body() dto: ChatRequestDto, @CurrentUser() actor: AuthUser) {
        return this.chatService.chat(dto, actor);
    }

    @Post("chat/stream")
    @AuthenticatedOnly()
    @HttpCode(HttpStatus.OK)
    async chatStream(
        @Body() dto: ChatRequestDto,
        @CurrentUser() actor: AuthUser,
        @Req() request: StreamRequestLike,
        @Res() reply: SseReplyLike,
    ): Promise<void> {
        await this.chatService.streamChat(dto, actor, request, reply);
    }
}
