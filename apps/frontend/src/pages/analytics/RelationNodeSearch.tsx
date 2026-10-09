import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { RELATION_TYPES, type RelationNode } from "@/data/relations";

const RESULT_LIMIT = 40;
const typeNames = Object.fromEntries(RELATION_TYPES.map(type => [type.key, type.name]));

function describeNode(node: RelationNode): string {
    const facts = node.facts;
    switch (facts.type) {
        case "bom":
            return `库存 ${facts.stock} ${facts.unit}`;
        case "customer":
            return `客户编号 ${facts.code}`;
        case "order":
        case "inbound":
        case "outbound":
            return `${facts.date} · 数量 ${facts.qty} ${facts.unit}`;
        case "person":
            return node.properties.角色 || facts.role;
    }
}

/** 只在查找时挂载少量候选节点；图数据较多也不会生成同等数量的 DOM。 */
export function RelationNodeSearch({
    nodes,
    selectedId,
    onSelect,
    disabled = false,
}: {
    nodes: RelationNode[];
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    disabled?: boolean;
}) {
    const id = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const composingRef = useRef(false);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(-1);
    const [position, setPosition] = useState<CSSProperties>({ left: 0, bottom: 0, width: 0, maxHeight: 0 });
    const selected = useMemo(() => nodes.find(node => node.id === selectedId), [nodes, selectedId]);
    const nameCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const node of nodes) {
            const key = `${node.type}:${node.name}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return counts;
    }, [nodes]);
    const searchable = useMemo(
        () =>
            nodes.map(node => ({
                node,
                text: `${node.name} ${node.id} ${typeNames[node.type]} ${node.type}`.toLowerCase(),
            })),
        [nodes],
    );
    const { results, hasMore } = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        const matches: RelationNode[] = [];
        for (const item of searchable) {
            if (!keyword || item.text.includes(keyword)) {
                if (matches.length === RESULT_LIMIT) return { results: matches, hasMore: true };
                matches.push(item.node);
            }
        }
        return { results: matches, hasMore: false };
    }, [searchable, query]);
    const expanded = open && !disabled;

    useEffect(() => {
        if (!expanded) return;
        const reposition = () => {
            const rect = inputRef.current?.getBoundingClientRect();
            if (!rect) return;
            const width = Math.min(Math.max(rect.width, 280), Math.max(0, window.innerWidth - 16));
            setPosition({
                left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
                bottom: window.innerHeight - rect.top + 4,
                width,
                maxHeight: Math.max(0, Math.min(320, rect.top - 12)),
            });
        };
        const dismissOutside = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && !inputRef.current?.contains(target) && !popupRef.current?.contains(target)) {
                setOpen(false);
                setQuery("");
                setActive(-1);
            }
        };
        reposition();
        window.addEventListener("resize", reposition);
        window.addEventListener("scroll", reposition, true);
        document.addEventListener("pointerdown", dismissOutside);
        return () => {
            window.removeEventListener("resize", reposition);
            window.removeEventListener("scroll", reposition, true);
            document.removeEventListener("pointerdown", dismissOutside);
        };
    }, [expanded]);

    useEffect(() => {
        if (expanded && active >= 0) {
            document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: "nearest" });
        }
    }, [active, expanded, id]);

    const close = () => {
        setOpen(false);
        setQuery("");
        setActive(-1);
    };
    const show = () => {
        if (!disabled && !open) {
            setQuery("");
            setActive(-1);
            setOpen(true);
        }
    };
    const choose = (node: RelationNode) => {
        onSelect(node.id);
        close();
    };

    return (
        <div className="flex min-w-0 max-w-full items-center gap-2">
            <label htmlFor={id} className="shrink-0 text-12 text-muted">
                查找节点
            </label>
            <input
                id={id}
                ref={inputRef}
                role="combobox"
                autoComplete="off"
                aria-autocomplete="list"
                aria-expanded={expanded}
                aria-controls={expanded ? `${id}-list` : undefined}
                aria-activedescendant={expanded && results[active] ? `${id}-option-${active}` : undefined}
                disabled={disabled}
                value={expanded ? query : (selected?.name ?? "")}
                placeholder="名称、编号或类型"
                title={selected?.name}
                onFocus={show}
                onClick={show}
                onBlur={close}
                onCompositionStart={() => {
                    composingRef.current = true;
                }}
                onCompositionEnd={() => {
                    composingRef.current = false;
                }}
                onChange={event => {
                    setQuery(event.target.value);
                    setOpen(true);
                    setActive(-1);
                }}
                onKeyDown={event => {
                    if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
                    if (event.key === "Escape" && expanded) {
                        event.preventDefault();
                        event.stopPropagation();
                        close();
                    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        setOpen(true);
                        setActive(current => {
                            if (!results.length) return -1;
                            if (current < 0) return event.key === "ArrowDown" ? 0 : results.length - 1;
                            return Math.max(
                                0,
                                Math.min(results.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)),
                            );
                        });
                    } else if (event.key === "Enter" && expanded) {
                        event.preventDefault();
                        if (results[active]) choose(results[active]);
                    }
                }}
                className="h-8 w-60 min-w-0 rounded-input border border-line bg-surface px-2.5 text-12 text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {expanded &&
                createPortal(
                    <div
                        ref={popupRef}
                        style={position}
                        className="fixed z-200 overflow-y-auto overscroll-contain rounded-input border border-line bg-surface p-1 shadow-modal"
                        onMouseDown={event => event.preventDefault()}
                    >
                        <p role="status" className="px-2.5 py-2 text-12 text-muted">
                            {hasMore
                                ? `显示前 ${RESULT_LIMIT} 个结果，还有更多，请输入关键词`
                                : results.length
                                  ? `${results.length} 个匹配节点`
                                  : "未找到匹配节点，请调整关键词"}
                        </p>
                        <ul id={`${id}-list`} role="listbox" aria-label="节点搜索结果">
                            {results.map((node, index) => (
                                <li
                                    key={node.id}
                                    id={`${id}-option-${index}`}
                                    role="option"
                                    aria-selected={node.id === selectedId}
                                    onMouseMove={() => setActive(index)}
                                    onClick={() => choose(node)}
                                    className={`flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 ${index === active ? "bg-primary-soft text-primary-strong" : "text-ink hover:bg-soft"}`}
                                >
                                    <span className="mt-0.5 w-14 shrink-0 text-12 text-muted">
                                        {typeNames[node.type]}
                                    </span>
                                    <div className="min-w-0">
                                        <div className="wrap-break-word text-13">{node.name}</div>
                                        <div className="wrap-break-word text-12 text-muted">
                                            {describeNode(node)}
                                            {(nameCounts.get(`${node.type}:${node.name}`) ?? 0) > 1 &&
                                                ` · 记录尾号 …${node.id.slice(node.id.lastIndexOf(":") + 1).slice(-6)}`}
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>,
                    document.body,
                )}
        </div>
    );
}
