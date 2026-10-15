import { useMemo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Flowchart } from "./Flowchart";

/** Markdown 由 React 渲染，禁用原始 HTML 和远程图片，业务文字不会成为可执行页面。 */
export function ChatMarkdown({ children, streaming = false }: { children: string; streaming?: boolean }) {
    // 保持组件类型稳定，避免滚动或文字更新时卸载已显示的表格/流程图。
    const components = useMemo<Components>(
        () => ({
            pre: ({ children: block }) => <div className="ai-code-block">{block}</div>,
            code: ({ className, children: code }) =>
                className?.split(" ").includes("language-mermaid") ? (
                    <Flowchart code={String(code).trim()} pending={streaming} />
                ) : (
                    <code className={className}>{code}</code>
                ),
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
        }),
        [streaming],
    );
    return (
        <div className="ai-markdown">
            <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
                {children}
            </Markdown>
        </div>
    );
}
