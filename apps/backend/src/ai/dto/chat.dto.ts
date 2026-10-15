import { Type } from "class-transformer";
import {
    Allow,
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsIn,
    IsObject,
    IsOptional,
    IsString,
    Length,
    ValidateBy,
    ValidateIf,
    ValidateNested,
} from "class-validator";
import { AI_CHAT_LIMITS } from "../ai-docs-topics";

export type ChatContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

function validContent(value: unknown, message: ChatMessageDto): boolean {
    if (value === undefined) return message.role === "assistant" && Boolean(message.tool_calls?.length);
    if (typeof value === "string")
        return value.length <= AI_CHAT_LIMITS.messageMaxChars && (message.role === "assistant" || value.length > 0);
    if (message.role !== "user" || !Array.isArray(value) || value.length < 1 || value.length > 6) return false;
    let textLength = 0;
    let images = 0;
    for (const part of value as ChatContentPart[]) {
        if (part?.type === "text" && typeof part.text === "string") {
            textLength += part.text.length;
        } else if (part?.type === "image_url" && typeof part.image_url?.url === "string") {
            images += 1;
            if (
                part.image_url.url.length > 180_000 ||
                !/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(part.image_url.url)
            )
                return false;
        } else return false;
    }
    return images <= 5 && textLength <= AI_CHAT_LIMITS.messageMaxChars;
}

/** 对话消息（OpenAI 兼容 messages 子集）：多轮对话 + 工具调用循环
 *  （assistant 携带 tool_calls、tool 回传工具结果，供前端 agent 编排使用） */
export class ChatToolCallFunctionDto {
    @IsString()
    @Length(1, 64)
    name!: string;

    /** 工具参数（JSON 字符串，OpenAI 兼容原样透传） */
    @IsOptional()
    @IsString()
    @Length(0, AI_CHAT_LIMITS.messageMaxChars)
    arguments?: string;
}

export class ChatToolCallDto {
    @IsString()
    @Length(1, 64)
    id!: string;

    @IsIn(["function"])
    type!: "function";

    @IsObject()
    @ValidateNested()
    @Type(() => ChatToolCallFunctionDto)
    function!: ChatToolCallFunctionDto;
}

export class ChatMessageDto {
    @IsIn(["system", "user", "assistant", "tool"])
    role!: "system" | "user" | "assistant" | "tool";

    /** assistant 带 tool_calls 时可为空串；其余场景为正文 */
    @ValidateBy({
        name: "chatContent",
        validator: {
            validate: (value, args) => validContent(value, args!.object as ChatMessageDto),
            defaultMessage: () =>
                "content 须为有效正文或用户消息的文本/图片内容，文本最多 16000 字符，图片最多 5 张且须为压缩后的图片数据",
        },
    })
    content?: string | ChatContentPart[];

    /** role=assistant 的工具调用意图（透传上游产物） */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(16)
    @ValidateNested({ each: true })
    @Type(() => ChatToolCallDto)
    tool_calls?: ChatToolCallDto[];

    /** role=tool 时对应的 tool_call_id */
    @ValidateIf((message: ChatMessageDto) => message.role === "tool" || message.tool_call_id !== undefined)
    @IsString()
    @Length(1, 64)
    tool_call_id?: string;
}

/** 可注册的工具定义（OpenAI 兼容 function 工具；由前端 agent 编排注入） */
export class ChatToolFunctionDto {
    @IsString()
    @Length(1, 64)
    name!: string;

    @IsOptional()
    @IsString()
    @Length(0, 1024)
    description?: string;

    /** JSON Schema 参数定义（结构原样透传） */
    @IsOptional()
    @IsObject()
    parameters?: Record<string, unknown>;
}

export class ChatToolDto {
    @IsIn(["function"])
    type!: "function";

    @IsObject()
    @ValidateNested()
    @Type(() => ChatToolFunctionDto)
    function!: ChatToolFunctionDto;
}

/** POST /ai/chat 与 /ai/chat/stream 的请求体（后端代理转发，按登录人记账）：
 *  上限 40 条 × 16k 字符（工具调用循环会追加 assistant/tool 消息，故高于纯人工对话；
 *  字符数为限制、JSON 字节体积仍受 Fastify 默认 1MiB bodyLimit 约束，超限 413）。 */
export class ChatRequestDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(AI_CHAT_LIMITS.maxMessages)
    @ValidateNested({ each: true })
    @Type(() => ChatMessageDto)
    messages!: ChatMessageDto[];

    /** 工具目录（最多 16 个）；省略则纯对话 */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(16)
    @ValidateNested({ each: true })
    @Type(() => ChatToolDto)
    tools?: ChatToolDto[];

    /** OpenAI 兼容取值：auto / none / required / {type:"function",function:{name}}，原样透传 */
    @IsOptional()
    @Allow()
    tool_choice?: unknown;
}
