import { Icon } from "@/lib/icons";
import { ChatMarkdown } from "./ChatMarkdown";

/** 仅展示服务实际返回的思考文字与实际执行的查询步骤。 */
export function ThinkingPanel({
    reasoning,
    steps = [],
    busy,
}: {
    reasoning?: string;
    steps?: string[];
    busy: boolean;
}) {
    if (!reasoning && !steps.length) return null;
    return (
        <details className="ai-chat-thinking">
            <summary>
                <span className={busy ? "ai-thinking-pulse" : ""} aria-hidden="true">
                    <Icon name={busy ? "spark" : "check"} size={15} />
                </span>
                <span>
                    {busy ? (reasoning ? "正在思考" : steps.at(-1) || "正在处理") : reasoning ? "思考过程" : "处理过程"}
                </span>
                <Icon name="chevron-down" size={14} className="ai-thinking-chevron" />
            </summary>
            <div className="ai-chat-thinking-body">
                {reasoning && <ChatMarkdown>{reasoning}</ChatMarkdown>}
                {steps.length > 0 && (
                    <ol className="ai-chat-steps">
                        {steps.map((step, index) => (
                            <li key={`${index}:${step}`}>{step}</li>
                        ))}
                    </ol>
                )}
            </div>
        </details>
    );
}
