import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchAiDocs } from "@/api/ai-chat";
import { uuid } from "@/lib/utils";
import { runChatAgent } from "./agent";
import type { ChatAttachment, ChatMessage } from "./types";
import { AI_QUERY_STALE_MS, aiQueryKey, queryAiData } from "./query-cache";

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
    const queryClient = useQueryClient();
    const [messages, setMessages] = useState(() => restore(options.storageKey));
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState("");
    const active = useRef<AbortController | null>(null);
    const generation = useRef(0);

    useEffect(
        () =>
            queryClient.getMutationCache().subscribe(event => {
                if (event.type === "updated" && event.action.type === "success") {
                    void queryClient.invalidateQueries({ queryKey: aiQueryKey(options.storageKey) });
                }
            }),
        [queryClient, options.storageKey],
    );

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
        let pending: Partial<ChatMessage> = {};
        let frame: number | undefined;
        const flush = () => {
            if (frame !== undefined) cancelAnimationFrame(frame);
            frame = undefined;
            if (Object.keys(pending).length) update(pending);
            pending = {};
        };
        const schedule = (patch: Partial<ChatMessage>) => {
            pending = { ...pending, ...patch };
            if (typeof requestAnimationFrame !== "function") flush();
            else frame ??= requestAnimationFrame(flush);
        };
        try {
            const docs = await queryClient.fetchQuery({
                queryKey: [...aiQueryKey(options.storageKey), "manifest"],
                queryFn: () => fetchAiDocs(controller.signal),
                staleTime: AI_QUERY_STALE_MS,
                gcTime: AI_QUERY_STALE_MS,
                retry: false,
            });
            controller.signal.throwIfAborted();
            const content = await runChatAgent({
                root: docs.root,
                history,
                identity: options.identity,
                can: options.can,
                signal: controller.signal,
                onText: text => schedule({ content: text }),
                onContext: context => update({ context }),
                query: (path, signal, fresh) => queryAiData(queryClient, options.storageKey, path, signal, fresh),
                onProgress: text => {
                    if (generation.current !== seq) return;
                    setProgress(text);
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
            flush();
            update({ content, state: "complete" });
        } catch (error) {
            flush();
            update({
                state: controller.signal.aborted ? "stopped" : "error",
                error: controller.signal.aborted
                    ? undefined
                    : error instanceof Error
                      ? error.message
                      : "AI 暂时无法回答，请重试",
            });
        } finally {
            if (frame !== undefined) cancelAnimationFrame(frame);
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
