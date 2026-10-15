import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, Length, ValidateNested } from "class-validator";

/** 对话消息（OpenAI 兼容的 messages 子集；不含 tool/image 等扩展） */
export class ChatMessageDto {
    @IsIn(["system", "user", "assistant"])
    role: "system" | "user" | "assistant";

    @IsString()
    @Length(1, 16_000)
    content: string;
}

/** POST /ai/chat 与 /ai/chat/stream 的请求体（后端代理转发，按登录人记账）：
 *  上限 20 条 × 16k 字符（最坏 ~0.9MB < Fastify 默认 1MiB bodyLimit）。 */
export class ChatRequestDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(20)
    @ValidateNested({ each: true })
    @Type(() => ChatMessageDto)
    messages: ChatMessageDto[];
}
