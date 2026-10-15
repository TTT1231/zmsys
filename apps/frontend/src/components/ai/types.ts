export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export interface ToolCall {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
}
export interface ChatWireMessage {
    role: "system" | "user" | "assistant" | "tool";
    content?: string | ContentPart[];
    reasoning_content?: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}
export interface ChatUsage {
    status: "known" | "partial" | "unknown";
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}
export interface ChatAttachment {
    id: string;
    name: string;
    size: number;
    kind: "image" | "text";
    content: string;
}
export interface ChatSource {
    id: string;
    title: string;
    queriedAt: string;
    filters: Record<string, unknown>;
    data: unknown;
}
export interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    state?: "streaming" | "complete" | "error" | "stopped";
    attachments?: ChatAttachment[];
    sources?: ChatSource[];
    error?: string;
    historical?: boolean;
    reasoning?: string;
    steps?: string[];
    /** 当前轮实际发给模型的 assistant/tool 消息；只留内存，不写浏览器存储。 */
    context?: ChatWireMessage[];
}
export interface ChatToolDefinition {
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
}
