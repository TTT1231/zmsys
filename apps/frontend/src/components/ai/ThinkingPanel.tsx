import { Icon } from "@/lib/icons";

/** 对话中只提示正在生成回答，不把模型内部思考或工具执行记录展示出来。 */
export function ThinkingPanel({ busy }: { busy: boolean }) {
    if (!busy) return null;
    return (
        <p className="ai-chat-status">
            <span className="ai-thinking-pulse" aria-hidden="true">
                <Icon name="spark" size={15} />
            </span>
            <span>正在生成回答…</span>
        </p>
    );
}
