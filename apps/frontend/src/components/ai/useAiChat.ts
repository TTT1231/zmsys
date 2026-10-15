import { useEffect, useRef, useState } from "react";
import { fetchAiDocs } from "@/api/ai-chat";
import { uuid } from "@/lib/utils";
import { runChatAgent } from "./agent";
import type { ChatAttachment, ChatMessage } from "./types";

function restore(key: string): ChatMessage[] {
    try {
        const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
        if (!Array.isArray(stored)) return [];
        return stored
            .filter((message): message is ChatMessage =>
                Boolean(message && ["user", "assistant"].includes(message.role) && typeof message.content === "string"),
            )
            .slice(-20)
            .map(message => ({
                id: uuid(),
                role: message.role,
                content:
                    message.role === "user" && !message.content.trim()
                        ? "此前发送了附件，刷新后请重新添加附件。"
                        : message.content.slice(0, 24_000),
                state: ["streaming", "error", "stopped"].includes(message.state ?? "complete") ? "stopped" : "complete",
                historical: true,
            }));
    } catch {
        return [];
    }
}

export function useAiChat(options: {
    storageKey: string;
    identity: string;
    can: (code: string) => boolean;
    onSettled: () => void;
}) {
    const [messages, setMessages] = useState(() => restore(options.storageKey));
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState("");
    const active = useRef<AbortController | null>(null);
    const generation = useRef(0);

    useEffect(
        () => () => {
            generation.current += 1;
            active.current?.abort();
        },
        [],
    );
    useEffect(() => {
        if (busy) return;
        try {
            sessionStorage.setItem(
                options.storageKey,
                JSON.stringify(
                    messages
                        .slice(-20)
                        .map(message => ({ role: message.role, content: message.content, state: message.state })),
                ),
            );
        } catch {
            /* 存储受限时本次对话仍可使用 */
        }
    }, [messages, busy, options.storageKey]);

    const run = async (history: ChatMessage[]) => {
        if (active.current) return;
        const controller = new AbortController();
        active.current = controller;
        const seq = ++generation.current;
        const replyId = uuid();
        setMessages([...history, { id: replyId, role: "assistant", content: "", state: "streaming", sources: [] }]);
        setBusy(true);
        setProgress("正在准备对话…");
        const update = (patch: Partial<ChatMessage>) => {
            if (generation.current !== seq) return;
            setMessages(current =>
                current.map(message => (message.id === replyId ? { ...message, ...patch } : message)),
            );
        };
        try {
            const docs = await fetchAiDocs(controller.signal);
            controller.signal.throwIfAborted();
            const content = await runChatAgent({
                root: docs.root,
                history,
                identity: options.identity,
                can: options.can,
                signal: controller.signal,
                onText: text => update({ content: text }),
                onProgress: text => {
                    if (generation.current === seq) setProgress(text);
                },
                onSource: source => {
                    if (generation.current !== seq) return;
                    setMessages(current =>
                        current.map(message =>
                            message.id === replyId
                                ? { ...message, sources: [...(message.sources ?? []), source] }
                                : message,
                        ),
                    );
                },
            });
            update({ content, state: "complete" });
        } catch (error) {
            update({
                state: controller.signal.aborted ? "stopped" : "error",
                error: controller.signal.aborted
                    ? undefined
                    : error instanceof Error
                      ? error.message
                      : "AI 暂时无法回答，请重试",
            });
        } finally {
            if (generation.current === seq) {
                active.current = null;
                setBusy(false);
                setProgress("");
                options.onSettled();
            }
        }
    };

    return {
        messages,
        busy,
        progress,
        send: (content: string, attachments: ChatAttachment[]) =>
            run([...messages, { id: uuid(), role: "user", content, attachments }]),
        retry: () => {
            const lastUser = messages.findLastIndex(message => message.role === "user");
            if (lastUser >= 0) return run(messages.slice(0, lastUser + 1));
        },
        stop: () => active.current?.abort(),
        clear: () => {
            generation.current += 1;
            active.current?.abort();
            active.current = null;
            setMessages([]);
            setBusy(false);
            setProgress("");
            try {
                sessionStorage.removeItem(options.storageKey);
            } catch {
                /* 同上 */
            }
        },
    };
}
