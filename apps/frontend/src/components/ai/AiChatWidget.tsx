import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { fetchAiStatus } from "@/api/ai";
import { useApp } from "@/context/useApp";
import type { PermCode } from "@/data/permissions";
import { Icon } from "@/lib/icons";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { CHAT_LIMITS } from "./agent";
import { ATTACHMENT_ACCEPT, readChatAttachment } from "./attachments";
import { ChatMarkdown } from "./ChatMarkdown";
import { SourceRecords } from "./SourceRecords";
import { useAiChat } from "./useAiChat";
import { useSpeechInput } from "./useSpeechInput";
import type { ChatAttachment, ChatSource } from "./types";
import "./chat.css";

const SUGGESTIONS = ["今天成品的出入库情况", "我如何调整BOM结构", "这个分析页怎么用的"];

export default function AiChatWidget() {
    const { user, role, grant, can } = useApp();
    const [open, setOpen] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [unread, setUnread] = useState(false);
    const [draft, setDraft] = useState("");
    const [files, setFiles] = useState<ChatAttachment[]>([]);
    const [reading, setReading] = useState(false);
    const [error, setError] = useState("");
    const [source, setSource] = useState<ChatSource | null>(null);
    const [preview, setPreview] = useState<ChatAttachment | null>(null);
    const [confirmClear, setConfirmClear] = useState(false);
    const [showDown, setShowDown] = useState(false);
    const [dropping, setDropping] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
    const isOpen = useRef(open);
    const panel = useRef<HTMLElement>(null);
    const launcher = useRef<HTMLButtonElement>(null);
    const textarea = useRef<HTMLTextAreaElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const body = useRef<HTMLDivElement>(null);
    const follow = useRef(true);
    const fileGeneration = useRef(0);
    const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
    const dropDepth = useRef(0);
    const voiceBase = useRef("");
    const chat = useAiChat({
        storageKey: `zm-ai-chat:${user!.account}:${role}:${grant.version}`,
        identity: `${user!.name}（${user!.account}）`,
        can: code => (code.startsWith("menu:") ? grant.menus.includes(code.slice(5)) : can(code as PermCode)),
        onSettled: () => {
            if (!isOpen.current) setUnread(true);
        },
    });
    const speech = useSpeechInput(
        text => setDraft((voiceBase.current + text).slice(0, CHAT_LIMITS.messageMaxChars)),
        setError,
    );
    const status = useQuery({
        queryKey: ["ai-status"],
        queryFn: fetchAiStatus,
        enabled: open,
        staleTime: 30_000,
        retry: false,
    });
    const ready = Boolean(status.data?.enabled && status.data.configured);

    const setPanelOpen = (value: boolean) => {
        isOpen.current = value;
        setOpen(value);
        if (value) {
            setUnread(false);
            follow.current = true;
        } else {
            speech.stop();
            launcher.current?.focus();
        }
    };
    const clamp = (left: number, top: number) => {
        const rect = panel.current?.getBoundingClientRect();
        return {
            left: Math.max(16, Math.min(left, window.innerWidth - (rect?.width ?? 400) - 16)),
            top: Math.max(16, Math.min(top, window.innerHeight - (rect?.height ?? 620) - 16)),
        };
    };
    useEffect(() => {
        const resize = () => setPosition(current => (current ? clamp(current.left, current.top) : null));
        window.addEventListener("resize", resize);
        return () => {
            window.removeEventListener("resize", resize);
            fileGeneration.current += 1;
        };
    }, []);
    useEffect(() => {
        if (!open) return;
        textarea.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (
                event.defaultPrevented ||
                event.isComposing ||
                event.key !== "Escape" ||
                source ||
                preview ||
                confirmClear ||
                document.querySelector('[aria-modal="true"]')
            )
                return;
            event.preventDefault();
            speech.stop();
            isOpen.current = false;
            setOpen(false);
            launcher.current?.focus();
        };
        const onOutside = (event: globalThis.PointerEvent) => {
            if (source || preview || confirmClear || document.querySelector('[aria-modal="true"]')) return;
            if (panel.current?.contains(event.target as Node) || launcher.current?.contains(event.target as Node))
                return;
            speech.stop();
            isOpen.current = false;
            setOpen(false);
        };
        const onFileDrag = (event: DragEvent) => {
            if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
        };
        const onFileDrop = (event: DragEvent) => {
            onFileDrag(event);
            dropDepth.current = 0;
            setDropping(false);
        };
        document.addEventListener("keydown", onKey);
        document.addEventListener("pointerdown", onOutside);
        document.addEventListener("dragover", onFileDrag);
        document.addEventListener("drop", onFileDrop);
        return () => {
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("pointerdown", onOutside);
            document.removeEventListener("dragover", onFileDrag);
            document.removeEventListener("drop", onFileDrop);
        };
    }, [open, source, preview, confirmClear, speech.stop]);
    useLayoutEffect(() => {
        if (open && follow.current && body.current) body.current.scrollTop = body.current.scrollHeight;
    }, [chat.messages, chat.progress, open]);
    useLayoutEffect(() => {
        if (!textarea.current) return;
        textarea.current.style.height = "auto";
        textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 132)}px`;
    }, [draft, open]);

    const addFiles = async (list: FileList | File[] | null) => {
        if (!list || reading || chat.busy) return;
        const incoming = Array.from(list);
        if (incoming.length + files.length > 5) {
            setError("每次最多添加 5 个附件，请先移除部分附件");
            return;
        }
        const seq = fileGeneration.current;
        setReading(true);
        setError("");
        try {
            for (const file of incoming) {
                const attachment = await readChatAttachment(file);
                if (seq !== fileGeneration.current) return;
                setFiles(current => [...current, attachment]);
            }
        } catch (cause) {
            if (seq === fileGeneration.current)
                setError(cause instanceof Error ? cause.message : "文件读取失败，请重试");
        } finally {
            if (seq === fileGeneration.current) setReading(false);
        }
    };
    const send = async (text = draft) => {
        if (chat.busy || reading || speech.recording || !ready || (!text.trim() && !files.length)) return;
        const totalText =
            text.length +
            files
                .filter(file => file.kind === "text")
                .reduce((sum, file) => sum + file.content.length + file.name.length + 40, 0);
        if (totalText > CHAT_LIMITS.messageMaxChars) {
            setError("消息与文本附件合计超过 16000 字符，请减少内容");
            return;
        }
        setError("");
        follow.current = true;
        try {
            const sending = chat.send(text.trim(), files);
            setDraft("");
            setFiles([]);
            await sending;
        } catch (cause) {
            setError(cause instanceof Error ? `发送失败：${cause.message}` : "发送失败，请重试");
        }
    };
    const startDrag = (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("button") || window.innerWidth < 600) return;
        const rect = panel.current!.getBoundingClientRect();
        drag.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const moveDrag = (event: PointerEvent<HTMLElement>) => {
        const start = drag.current;
        if (!start || Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) < 4) return;
        setDragging(true);
        setPosition(clamp(start.left + event.clientX - start.x, start.top + event.clientY - start.y));
    };
    const endDrag = () => {
        drag.current = null;
        setDragging(false);
    };
    const lastMessage = chat.messages.at(-1);

    return (
        <>
            <button
                ref={launcher}
                type="button"
                className={`ai-chat-fab ${open ? "is-open" : ""}`}
                aria-label={open ? "收起众茂AI" : unread ? "打开众茂AI，有新回答" : "打开众茂AI"}
                aria-expanded={open}
                aria-controls="zm-ai-panel"
                onClick={() => setPanelOpen(!open)}
            >
                <Icon name="spark" size={26} />
                {unread && (
                    <span
                        className="absolute top-0.5 right-0.5 size-3 rounded-full border-2 border-surface bg-danger"
                        aria-hidden="true"
                    />
                )}
            </button>
            <section
                ref={panel}
                id="zm-ai-panel"
                role="dialog"
                aria-modal="false"
                aria-labelledby="zm-ai-title"
                inert={!open}
                className={`ai-chat-panel ${open ? "is-open" : ""} ${expanded ? "is-expanded" : ""} ${dragging ? "is-dragging" : ""}`}
                style={
                    position && window.innerWidth >= 600
                        ? { left: position.left, top: position.top, right: "auto", transform: "none" }
                        : undefined
                }
                onDragEnter={event => {
                    if (!event.dataTransfer.types.includes("Files")) return;
                    event.preventDefault();
                    dropDepth.current += 1;
                    setDropping(true);
                }}
                onDragOver={event => {
                    if (event.dataTransfer.types.includes("Files")) event.preventDefault();
                }}
                onDragLeave={() => {
                    dropDepth.current = Math.max(0, dropDepth.current - 1);
                    if (!dropDepth.current) setDropping(false);
                }}
                onDrop={event => {
                    event.preventDefault();
                    dropDepth.current = 0;
                    setDropping(false);
                    void addFiles(event.dataTransfer.files);
                }}
            >
                <header
                    className="flex shrink-0 touch-none items-center gap-2 border-b border-line bg-panel px-3 py-2 select-none sm:cursor-move"
                    onPointerDown={startDrag}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                >
                    <span className="ai-chat-avatar size-8.5 rounded-xl">
                        <Icon name="spark" size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h2 id="zm-ai-title" className="text-14 font-semibold">
                            众茂AI
                        </h2>
                        <p className="flex items-center gap-1.5 truncate text-11 text-muted">
                            <span className={`size-1.5 shrink-0 rounded-full ${ready ? "bg-success" : "bg-muted"}`} />
                            <span className="truncate">
                                {status.isFetching && !status.data
                                    ? "正在连接…"
                                    : status.isError
                                      ? "连接失败"
                                      : ready
                                        ? status.data?.model
                                        : "服务未就绪"}
                            </span>
                        </p>
                    </div>
                    <Icon name="grip" size={15} className="hidden text-muted sm:block" />
                    <Button
                        iconOnly
                        aria-label={expanded ? "收起阅读" : "展开阅读"}
                        aria-pressed={expanded}
                        title={expanded ? "收起阅读" : "展开阅读"}
                        onClick={() => {
                            setExpanded(!expanded);
                            setPosition(null);
                        }}
                    >
                        <Icon name={expanded ? "minimize" : "maximize"} size={17} />
                    </Button>
                    <Button
                        iconOnly
                        aria-label="清空对话"
                        title="清空对话"
                        disabled={!chat.messages.length && !draft && !files.length}
                        onClick={() => setConfirmClear(true)}
                    >
                        <Icon name="trash" size={17} />
                    </Button>
                    <Button iconOnly aria-label="收起聊天面板" title="收起" onClick={() => setPanelOpen(false)}>
                        <Icon name="close" size={18} />
                    </Button>
                </header>
                <div
                    ref={body}
                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 pt-4 pb-2"
                    onScroll={() => {
                        const element = body.current!;
                        follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
                        setShowDown(!follow.current);
                    }}
                >
                    <div className="ai-chat-message">
                        <span className="ai-chat-avatar mt-0.5 size-6.5 shrink-0 rounded-input">
                            <Icon name="spark" size={16} />
                        </span>
                        <div className="ai-chat-bubble ai-chat-bot">
                            <ChatMarkdown>
                                {"嗨，我是 **众茂AI**！可以帮你查询订单、库存等，也能解答系统操作问题"}
                            </ChatMarkdown>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {SUGGESTIONS.map(text => (
                                    <button
                                        type="button"
                                        className="ai-chat-chip"
                                        key={text}
                                        disabled={chat.busy || !ready || speech.recording || reading}
                                        onClick={() => send(text)}
                                    >
                                        {text}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                    {!ready && open && (
                        <div
                            className="mb-4 rounded-input border border-line bg-surface p-3 text-12.5 text-muted"
                            role="status"
                        >
                            {status.isError ? (
                                <>
                                    {status.error.message}
                                    <button
                                        type="button"
                                        className="ml-2 text-primary-strong underline"
                                        onClick={() => void status.refetch()}
                                    >
                                        重新连接
                                    </button>
                                </>
                            ) : status.isPending ? (
                                "正在读取 AI 服务状态…"
                            ) : (
                                <>
                                    AI 服务尚未启用或配置，请联系超级管理员。
                                    {grant.menus.includes("ai-workbench") && (
                                        <Link
                                            to="/ai-workbench"
                                            onClick={() => setPanelOpen(false)}
                                            className="ml-1 text-primary-strong underline"
                                        >
                                            前往 AI 工作台
                                        </Link>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                    <div role="log" aria-label="聊天记录" aria-live="off">
                        {chat.messages.map(message => (
                            <div
                                key={message.id}
                                className={`ai-chat-message ${message.role === "user" ? "is-user" : ""}`}
                            >
                                {message.role === "assistant" && (
                                    <span className="ai-chat-avatar mt-0.5 size-6.5 shrink-0 rounded-input">
                                        <Icon name="spark" size={16} />
                                    </span>
                                )}
                                <div
                                    className={`ai-chat-bubble ${message.role === "user" ? "ai-chat-user" : "ai-chat-bot"}`}
                                >
                                    {Boolean(message.attachments?.length) && (
                                        <div className="mb-2 flex flex-wrap gap-2">
                                            {message.attachments!.map(file => (
                                                <button
                                                    key={file.id}
                                                    type="button"
                                                    className="flex max-w-full items-center gap-1.5 rounded-input border border-current/20 p-1.5 text-12"
                                                    title={file.name}
                                                    onClick={() =>
                                                        file.kind === "image"
                                                            ? setPreview(file)
                                                            : setSource({
                                                                  id: file.id,
                                                                  title: file.name,
                                                                  queriedAt: new Date().toISOString(),
                                                                  filters: {},
                                                                  data: { 文本内容: file.content },
                                                              })
                                                    }
                                                >
                                                    {file.kind === "image" ? (
                                                        <img
                                                            src={file.content}
                                                            alt={file.name}
                                                            className="size-12 rounded-md object-cover"
                                                        />
                                                    ) : (
                                                        <Icon name="file" size={16} />
                                                    )}
                                                    <span className="max-w-32 truncate">{file.name}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {message.role === "user" ? (
                                        <p className="whitespace-pre-wrap wrap-anywhere">{message.content}</p>
                                    ) : (
                                        <>
                                            {message.content ? (
                                                <ChatMarkdown>{message.content}</ChatMarkdown>
                                            ) : message.state === "streaming" ? (
                                                <span className="ai-chat-typing" aria-hidden="true">
                                                    <i />
                                                    <i />
                                                    <i />
                                                </span>
                                            ) : null}
                                            {message.state === "streaming" && message === lastMessage && (
                                                <p className="mt-2 text-11 text-muted">{chat.progress}</p>
                                            )}
                                            {message.historical && (
                                                <p className="mt-2 text-11 text-muted">
                                                    历史对话，当前业务数据请重新查询。
                                                </p>
                                            )}
                                            {(message.state === "stopped" || message.state === "error") && (
                                                <div className="mt-2 text-12.5">
                                                    {message.state === "error" ? (
                                                        <div
                                                            role="alert"
                                                            className="rounded-input border border-danger/25 bg-danger-soft p-2.5 text-danger"
                                                        >
                                                            <p className="flex items-center gap-1.5 font-medium">
                                                                <Icon name="alert" size={16} />
                                                                {message.content ? "回答中断" : "发送失败"}
                                                            </p>
                                                            <p className="mt-1 wrap-anywhere">
                                                                {message.error || "暂时无法连接 AI 服务，请稍后重试"}
                                                            </p>
                                                        </div>
                                                    ) : (
                                                        <p className="text-muted">已停止生成</p>
                                                    )}
                                                    {message === lastMessage && (
                                                        <button
                                                            type="button"
                                                            className="ai-chat-chip mt-2"
                                                            disabled={chat.busy || !ready}
                                                            onClick={() => {
                                                                follow.current = true;
                                                                void chat.retry();
                                                            }}
                                                        >
                                                            {message.state === "error" ? "重试" : "重新回答"}
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                            {Boolean(message.sources?.length) && (
                                                <div className="mt-3 border-t border-line pt-2">
                                                    <p className="text-11 text-muted">
                                                        查询于{" "}
                                                        {new Date(
                                                            message.sources!.at(-1)!.queriedAt,
                                                        ).toLocaleTimeString("zh-CN", {
                                                            timeZone: "Asia/Shanghai",
                                                            hour12: false,
                                                        })}
                                                    </p>
                                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                                        {message.sources!.map(item => (
                                                            <button
                                                                key={item.id}
                                                                type="button"
                                                                className="ai-chat-chip rounded-md"
                                                                onClick={() => setSource(item)}
                                                            >
                                                                查看{item.title}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="sr-only" role="status" aria-live="polite">
                    {chat.busy ? chat.progress : lastMessage?.state === "complete" ? "众茂AI 已回答" : ""}
                </div>
                {showDown && (
                    <button
                        type="button"
                        className="absolute right-5 bottom-37 flex size-9 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card"
                        aria-label="回到底部"
                        onClick={() => {
                            follow.current = true;
                            body.current?.scrollTo({
                                top: body.current.scrollHeight,
                                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                                    ? "auto"
                                    : "smooth",
                            });
                            setShowDown(false);
                        }}
                    >
                        <Icon name="arrow-down" size={16} />
                    </button>
                )}
                <footer className="shrink-0 px-3.5 pt-1 pb-3.5">
                    {error && (
                        <p role="alert" className="mb-2 text-12 text-danger">
                            {error}
                        </p>
                    )}
                    <div
                        className={`rounded-card border bg-surface p-2.5 transition-colors focus-within:border-primary ${speech.recording ? "border-danger" : "border-line-strong"}`}
                    >
                        {Boolean(files.length) && (
                            <div className="mb-2 flex flex-wrap gap-1.5">
                                {files.map(file => (
                                    <span
                                        key={file.id}
                                        className="flex max-w-full items-center gap-1 rounded-input border border-line bg-soft pl-2 text-12"
                                    >
                                        {file.kind === "image" ? (
                                            <button
                                                type="button"
                                                onClick={() => setPreview(file)}
                                                aria-label={`预览 ${file.name}`}
                                            >
                                                <img
                                                    src={file.content}
                                                    alt=""
                                                    className="size-8 rounded-md object-cover"
                                                />
                                            </button>
                                        ) : (
                                            <Icon name="file" size={15} />
                                        )}
                                        <span className="max-w-36 truncate" title={file.name}>
                                            {file.name}
                                        </span>
                                        <Button
                                            iconOnly
                                            className="size-9"
                                            aria-label={`移除 ${file.name}`}
                                            onClick={() =>
                                                setFiles(current => current.filter(item => item.id !== file.id))
                                            }
                                        >
                                            <Icon name="close" size={14} />
                                        </Button>
                                    </span>
                                ))}
                            </div>
                        )}
                        <textarea
                            ref={textarea}
                            rows={1}
                            maxLength={CHAT_LIMITS.messageMaxChars}
                            value={draft}
                            onChange={event => setDraft(event.target.value)}
                            aria-label="消息内容"
                            placeholder={speech.recording ? "正在聆听，再次点击麦克风结束…" : "给众茂AI 发送消息…"}
                            className="block max-h-33 min-h-8 w-full resize-none border-0 bg-transparent px-1 py-1 text-13.5 text-ink outline-none placeholder:text-muted focus-visible:outline-none"
                            onKeyDown={event => {
                                if (
                                    event.key === "Enter" &&
                                    !event.shiftKey &&
                                    !event.nativeEvent.isComposing &&
                                    event.keyCode !== 229
                                ) {
                                    event.preventDefault();
                                    send();
                                }
                            }}
                            onPaste={event => {
                                const pasted = Array.from(event.clipboardData.items)
                                    .filter(item => item.kind === "file")
                                    .map(item => item.getAsFile())
                                    .filter((file): file is File => file !== null);
                                if (pasted.length) {
                                    event.preventDefault();
                                    void addFiles(pasted);
                                }
                            }}
                        />
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1">
                                <Button
                                    iconOnly
                                    aria-label="添加附件"
                                    title="添加图片或文本文件，最多 5 个，单个不超过 10MB"
                                    disabled={reading || chat.busy}
                                    onClick={() => fileInput.current?.click()}
                                >
                                    <Icon name="paperclip" size={18} />
                                </Button>
                                {reading && (
                                    <span role="status" className="text-11 text-muted">
                                        正在读取…
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-1">
                                <Button
                                    iconOnly
                                    aria-label={speech.recording ? "结束语音输入" : "语音输入"}
                                    aria-pressed={speech.recording}
                                    title={speech.supported ? "语音输入" : "当前浏览器不支持语音输入"}
                                    disabled={chat.busy || reading}
                                    className={speech.recording ? "text-danger" : undefined}
                                    onClick={() => {
                                        voiceBase.current = draft;
                                        setError("");
                                        speech.start();
                                    }}
                                >
                                    <Icon name="microphone" size={18} />
                                </Button>
                                <Button
                                    iconOnly
                                    className="bg-primary text-white hover:bg-primary-hover hover:text-white disabled:bg-soft disabled:text-muted"
                                    aria-label={chat.busy ? "停止生成" : "发送消息"}
                                    title={chat.busy ? "停止生成" : "发送（Enter）"}
                                    disabled={
                                        !chat.busy &&
                                        (!ready || reading || speech.recording || (!draft.trim() && !files.length))
                                    }
                                    onClick={() => (chat.busy ? chat.stop() : send())}
                                >
                                    <Icon name={chat.busy ? "stop" : "arrow-up"} size={19} />
                                </Button>
                            </div>
                        </div>
                        <input
                            ref={fileInput}
                            type="file"
                            multiple
                            hidden
                            accept={ATTACHMENT_ACCEPT}
                            aria-label="选择聊天附件"
                            onChange={event => {
                                const selected = Array.from(event.target.files ?? []);
                                event.target.value = "";
                                void addFiles(selected);
                            }}
                        />
                    </div>
                </footer>
                {dropping && (
                    <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-card border-2 border-dashed border-primary bg-canvas/95 p-6 text-center text-13 font-medium text-primary-strong">
                        松开以添加图片或文本文件
                        <br />
                        最多 5 个，单个不超过 10MB
                    </div>
                )}
            </section>
            {source && <SourceRecords key={source.id} source={source} onClose={() => setSource(null)} />}
            {preview && (
                <Modal open onClose={() => setPreview(null)} title={preview.name} width={900}>
                    <img
                        src={preview.content}
                        alt={preview.name}
                        className="mx-auto max-h-[70dvh] max-w-full rounded-xl object-contain"
                    />
                </Modal>
            )}
            <Modal
                open={confirmClear}
                onClose={() => setConfirmClear(false)}
                title="清空对话"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setConfirmClear(false)}>
                            取消
                        </Button>
                        <Button
                            variant="danger"
                            onClick={() => {
                                chat.clear();
                                fileGeneration.current += 1;
                                speech.stop();
                                setDraft("");
                                setFiles([]);
                                setReading(false);
                                setError("");
                                setConfirmClear(false);
                            }}
                        >
                            清空对话
                        </Button>
                    </>
                }
            >
                <p className="text-14 text-muted">清空本次聊天记录和附件？正在生成的回答也会停止。</p>
            </Modal>
        </>
    );
}
