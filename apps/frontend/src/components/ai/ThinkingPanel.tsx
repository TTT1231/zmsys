import { Icon } from "@/lib/icons";
import { ChatMarkdown } from "./ChatMarkdown";

/** 仅展示服务实际返回的思考文字与实际执行的查询步骤；思考进行中只报当前状态，不铺开步骤列表。 */
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
    if (busy && !reasoning) {
        return (
            <p className="ai-chat-status">
                <span className="ai-thinking-pulse" aria-hidden="true">
                    <Icon name="spark" size={15} />
                </span>
                <span>{steps.at(-1) || "正在处理"}</span>
            </p>
        );
    }
    return (
        <details className="ai-chat-thinking">
            <summary>
                <span className={busy ? "ai-thinking-pulse" : ""} aria-hidden="true">
                    <Icon name={busy ? "spark" : "check"} size={15} />
                </span>
                <span>{busy ? "正在思考" : reasoning ? "思考过程" : "处理过程"}</span>
                <Icon name="chevron-down" size={14} className="ai-thinking-chevron" />
            </summary>
            <div className="ai-chat-thinking-body">
                {reasoning && <ChatMarkdown>{reasoning}</ChatMarkdown>}
                {!busy && steps.length > 0 && (
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
