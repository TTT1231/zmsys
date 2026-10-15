import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown 由 React 渲染，禁用原始 HTML 和远程图片，业务文字不会成为可执行页面。 */
export function ChatMarkdown({ children }: { children: string }) {
    return (
        <div className="ai-markdown">
            <Markdown
                remarkPlugins={[remarkGfm]}
                skipHtml
                components={{
                    a: ({ href, children: label }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer">
                            {label}
                        </a>
                    ),
                    img: ({ alt }) => <span>{alt ? `图片：${alt}` : "图片"}</span>,
                    table: ({ children: table }) => (
                        <div className="ai-table-wrap" tabIndex={0} role="region" aria-label="回答中的表格">
                            <table>{table}</table>
                        </div>
                    ),
                }}
            >
                {children}
            </Markdown>
        </div>
    );
}
