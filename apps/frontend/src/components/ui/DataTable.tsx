import {
    Children,
    cloneElement,
    Fragment,
    isValidElement,
    useEffect,
    useLayoutEffect,
    useImperativeHandle,
    useRef,
    useState,
    type ReactElement,
    type ReactNode,
    type Ref,
} from "react";
import { useApp } from "@/context/useApp";
import { Icon } from "@/lib/icons";
import { Modal } from "./Modal";
import { SortTh } from "./SortTh";
import { fitTableWidths, resizeTableColumn } from "@/lib/tableColumns";

interface CellProps {
    children?: ReactNode;
    label?: string;
    className?: string;
    style?: React.CSSProperties;
    colSpan?: number;
    width?: string;
    resizeControl?: ReactNode;
}
type Density = "compact" | "standard" | "roomy";
interface Preferences {
    widths: Record<string, number>;
    hidden: string[];
    density: Density;
}
interface DataTableProps {
    /** 单层表头和普通 tbody 行；表头文字作为稳定列标识。 */
    children: ReactNode;
    tableId: string;
    defaultWidths: number[];
    identityColumn?: number;
    /** 横向滚动时左侧固定的原始列索引（按从左到右）；缺省固定 identityColumn 一列。
     *  固定列不可在显示设置中隐藏，sticky 偏移按列宽累计（见 startOffsets）。 */
    pinnedStart?: number[];
    recordCount?: number;
    scrollRef?: Ref<HTMLDivElement>;
    scrollClassName?: string;
}
const emptyPreferences = (): Preferences => ({ widths: {}, hidden: [], density: "standard" });
const cells = (children: ReactNode) => Children.toArray(children).filter(isValidElement) as ReactElement<CellProps>[];
const labelOf = (node: ReactNode): string =>
    Children.toArray(node)
        .map(child => (isValidElement<CellProps>(child) ? labelOf(child.props.children) : String(child)))
        .join("")
        .trim();

function readPreferences(key: string): Preferences {
    try {
        const current = localStorage.getItem(key);
        // 新版只读取新版设置，旧布局完全弃用。
        const saved = JSON.parse(current ?? "null");
        if (!saved || typeof saved !== "object") return emptyPreferences();
        return {
            density:
                saved.density === "roomy"
                    ? "roomy"
                    : saved.density === "compact" || saved.compact === true
                      ? "compact"
                      : "standard",
            hidden: Array.isArray(saved.hidden) ? saved.hidden.filter((item: unknown) => typeof item === "string") : [],
            widths: current
                ? Object.fromEntries(
                      Object.entries(saved.widths ?? {})
                          .filter(
                              (entry): entry is [string, number] =>
                                  typeof entry[1] === "number" && Number.isFinite(entry[1]),
                          )
                          .map(([label, width]) => [label, Math.min(800, Math.max(96, Math.round(width)))]),
                  )
                : {},
        };
    } catch {
        return emptyPreferences();
    }
}

export function DataTable(props: DataTableProps) {
    const { user } = useApp();
    const storageKey = `zm-table:v2:${user?.account ?? "guest"}:${props.tableId}`;
    return <TableView key={storageKey} {...props} storageKey={storageKey} />;
}

function TableView({
    children,
    defaultWidths,
    identityColumn = 0,
    pinnedStart,
    recordCount,
    scrollRef,
    scrollClassName = "",
    storageKey,
}: DataTableProps & { storageKey: string }) {
    const bodyRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState(0);
    // 列最小宽锚定表头内容的完整宽度（managed-th 为 nowrap，scrollWidth 即文字+排序图标完整宽，
    // 与当前列宽无关）：表头回答"这列是什么"，任何压缩下都必须完整可读；列内容在窄列下
    // 截断（title 悬停/详情弹窗兜底）。jsdom 测不出宽度（scrollWidth=0）时不写入，走 90 兜底。
    const [headerMins, setHeaderMins] = useState<Record<string, number>>({});
    // 徽章列内容下限（.table-badge nowrap 不可截断，允许超过推荐宽），
    // 与表头下限取 max 作为列 min —— 溢出压缩时徽章列保完整
    const [badgeMins, setBadgeMins] = useState<Record<string, number>>({});
    const [preferences, setPreferences] = useState(() => readPreferences(storageKey));
    const [settings, setSettings] = useState(false);
    const [activeColumn, setActiveColumn] = useState<string | null>(null);
    const [draftPreferences, setDraftPreferences] = useState<Record<string, number> | null>(null);
    // 横向滚动进行中（scrollLeft>0）才显示固定区分界（对齐 antd 固定列：未滚动时无竖线阴影）
    const [scrolled, setScrolled] = useState(false);
    const dragRef = useRef<{
        label: string;
        start: number;
        width: number;
        base: Record<string, number>;
        draft: Record<string, number>;
    } | null>(null);
    const sections = cells(children);
    const head = sections.find(section => section.type === "thead");
    const headRow = cells(head?.props.children)[0];
    const headers = cells(headRow?.props.children);
    // 紧凑档=账本：次要信息行收纳后，宽内容列只剩单行，推荐宽收紧到 220，
    // 且不再吸收视口剩余宽度（fitTableWidths stretch:false），富余集中到操作列前的弹性区；
    // 手动拖拽与显示设置的调宽不受限（max 仍 800），标准/宽松档行为不变。
    const compact = preferences.density === "compact";
    // 左侧固定列集合：pinnedStart 优先，缺省固定 identity 列；固定列随 identity 一起锁定不可隐藏
    const startSet = new Set(pinnedStart ?? [identityColumn]);
    const lastStartIndex = Math.max(...startSet);
    const columns = headers.map((header, index) => {
        const label = header.props.label ?? labelOf(header.props.children);
        const width = defaultWidths[index] ?? 160;
        const wide = /BOM|成品|物料构成|客户信息/.test(label) && width >= 220;
        const recommended = compact && wide ? Math.min(width, 220) : width;
        return {
            header,
            index,
            label,
            key: label,
            width: recommended,
            min: Math.max(Math.min(recommended, headerMins[label] ?? 90), badgeMins[label] ?? 0),
            max: 800,
            grow: wide,
            fixed: index === headers.length - 1,
            locked: startSet.has(index) || index === headers.length - 1,
        };
    });
    const visible = columns.filter(column => column.locked || !preferences.hidden.includes(column.label));
    const widths = fitTableWidths(visible, draftPreferences ?? preferences.widths, viewport, {
        stretch: !compact,
    });
    const widthOf = (column: (typeof columns)[number]) => widths[column.label] ?? column.width;
    const totalWidth = visible.reduce((sum, column) => sum + widthOf(column), 0);
    // 自动列达到上限或全部被用户锁定时，以无语义弹性列补齐，并把固定操作列留在最右侧。
    const fillWidth = Math.max(0, viewport - totalWidth);
    const hasFillColumn = fillWidth > 0;
    const renderedColumnCount = visible.length + (hasFillColumn ? 1 : 0);
    const pinned = (index: number) =>
        startSet.has(index) ? "start" : index === headers.length - 1 ? "end" : undefined;
    // 多个 start 固定列的 sticky 偏移 = 前面固定列宽度之和（CSS 只给 left:0，多列会重叠）；
    // 依赖 widthOf，拖拽调宽 / 视口变化时随渲染重算
    const startOffsets = new Map<number, number>();
    let startAcc = 0;
    for (const index of [...startSet].sort((a, b) => a - b)) {
        const column = columns.find(item => item.index === index);
        if (!column) continue;
        startOffsets.set(index, startAcc);
        startAcc += widthOf(column);
    }
    useImperativeHandle(scrollRef, () => bodyRef.current!, []);
    useLayoutEffect(() => {
        const element = bodyRef.current;
        if (!element) return;
        // 视口测量合并到 rAF：布局动画期间 RO 可能同帧多次回调，逐次 setState 会让
        // 整表跟着逐帧重渲染（列宽重算 + 表头重测）；合并后每帧至多一次
        let raf = 0;
        const measure = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                setViewport(current => (current === element.clientWidth ? current : element.clientWidth));
            });
        };
        const onScroll = () => setScrolled(element.scrollLeft > 0);
        measure();
        onScroll();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
        observer?.observe(element);
        element.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", measure);
        return () => {
            cancelAnimationFrame(raf);
            observer?.disconnect();
            element.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", measure);
        };
    }, []);
    // 表头最小宽测量：密度切换 / 列显隐 / 视口缩放（含字体缩放）后重测。
    // th.scrollWidth 是 max(列宽, 内容宽)，列宽大于文字时量不出内容固有宽——
    // 用 Range 量内容节点（跳过列宽拖拽手柄）的真实包围盒，加左右 padding。
    // 单元格内的状态徽章（.table-badge）同样参与列 min：徽章 nowrap，被压缩
    // 截断即不可读（fitTableWidths 溢出时会把自动列压到表头宽），最长徽章宽
    // 与表头宽取 max 作为该列下限；文本列截断走 ellipsis 不受影响。
    useLayoutEffect(() => {
        const next: Record<string, number> = {};
        bodyRef.current?.querySelectorAll<HTMLElement>("thead th[aria-label]").forEach(th => {
            const label = th.getAttribute("aria-label");
            if (!label) return;
            const range = document.createRange();
            // jsdom 的 Range 未实现几何接口，测不了就走 90 兜底
            if (typeof range.getBoundingClientRect !== "function") return;
            let left = Number.POSITIVE_INFINITY;
            let right = Number.NEGATIVE_INFINITY;
            for (const node of Array.from(th.childNodes)) {
                if (node instanceof Element && node.classList.contains("column-resizer")) continue;
                range.selectNodeContents(node);
                const rect = range.getBoundingClientRect();
                if (rect.width > 0) {
                    left = Math.min(left, rect.left);
                    right = Math.max(right, rect.right);
                }
            }
            if (!(right > left)) return;
            const style = getComputedStyle(th);
            next[label] =
                Math.ceil(right - left + Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)) +
                2;
        });
        // 徽章列内容下限：按 td 在行内的位置对回同列 th 的 aria-label（填充列与
        // 跨列表头无 label 自动跳过；末列固定不参与压缩，错位无实际影响）
        const badges: Record<string, number> = {};
        bodyRef.current?.querySelectorAll<HTMLElement>("tbody td").forEach(td => {
            const badge = td.querySelector(":scope > .table-badge");
            if (!badge) return;
            const row = td.parentElement;
            const th = row
                ? Array.from(td.closest("table")?.querySelectorAll<HTMLElement>("thead th") ?? [])[
                      Array.from(row.children).indexOf(td)
                  ]
                : undefined;
            const label = th?.getAttribute("aria-label");
            if (!label) return;
            const style = getComputedStyle(td);
            const need = Math.ceil(
                badge.getBoundingClientRect().width +
                    Number.parseFloat(style.paddingLeft) +
                    Number.parseFloat(style.paddingRight),
            );
            badges[label] = Math.max(badges[label] ?? 0, need);
        });
        setHeaderMins(current => {
            const entries = Object.entries(next);
            const same =
                entries.length === Object.keys(current).length &&
                entries.every(([key, value]) => current[key] === value);
            return same ? current : next;
        });
        setBadgeMins(current => {
            const entries = Object.entries(badges);
            const same =
                entries.length === Object.keys(current).length &&
                entries.every(([key, value]) => current[key] === value);
            return same ? current : badges;
        });
    }, [viewport, headers.length, compact]);
    useEffect(() => {
        try {
            localStorage.removeItem(storageKey.replace(":v2:", ":v1:"));
            localStorage.setItem(storageKey, JSON.stringify(preferences));
        } catch {
            /* 存储受限时仍可在本次会话调整。 */
        }
    }, [preferences, storageKey]);
    const resize = (label: string, desired: number) => {
        const next = resizeTableColumn(visible, widths, label, desired);
        const nextWidth = next[label];
        if (nextWidth === undefined) return;
        setPreferences(current => ({ ...current, widths: { ...current.widths, [label]: nextWidth } }));
    };
    const restoreColumn = (label: string) =>
        setPreferences(current => {
            const widths = { ...current.widths };
            delete widths[label];
            return { ...current, widths };
        });
    const finishDrag = (cancel = false) => {
        const drag = dragRef.current;
        if (!drag) return;
        const nextWidth = drag.draft[drag.label];
        if (!cancel && nextWidth !== undefined)
            setPreferences(current => ({ ...current, widths: { ...current.widths, [drag.label]: nextWidth } }));
        dragRef.current = null;
        setDraftPreferences(null);
        setActiveColumn(null);
    };
    return (
        <div
            className="managed-table"
            data-density={preferences.density}
            data-scrolled={scrolled || undefined}
            data-resizing={!!draftPreferences || undefined}
        >
            <div className="table-display-toolbar">
                <span className="text-13 text-muted" role="status">
                    {draftPreferences
                        ? `正在调整「${activeColumn}」`
                        : recordCount !== undefined
                          ? `${recordCount} 条记录`
                          : ""}
                </span>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setPreferences(current => ({ ...current, widths: {} }))}
                        className="table-display-button"
                    >
                        适合屏幕
                    </button>
                    <button
                        type="button"
                        onClick={() => setSettings(true)}
                        className="table-display-button border border-line-strong"
                    >
                        <Icon name="settings" size={15} />
                        显示设置
                    </button>
                </div>
            </div>
            <div ref={bodyRef} className={`managed-table-body overflow-x-auto ${scrollClassName}`}>
                <table
                    className="data-table table-fixed border-separate border-spacing-0"
                    style={{ width: totalWidth + fillWidth }}
                >
                    <colgroup>
                        {visible.map((column, index) => (
                            <Fragment key={column.label}>
                                {hasFillColumn && index === visible.length - 1 && (
                                    <col data-table-fill="" style={{ width: fillWidth }} />
                                )}
                                <col style={{ width: widthOf(column) }} />
                            </Fragment>
                        ))}
                    </colgroup>
                    <thead>
                        <tr className={headRow?.props.className}>
                            {visible.map((column, index) => {
                                const control = !column.fixed ? (
                                    <span
                                        role="separator"
                                        aria-orientation="vertical"
                                        aria-label={`调整${column.label}列宽`}
                                        aria-valuemin={column.min}
                                        aria-valuemax={column.max}
                                        aria-valuenow={Math.round(widthOf(column))}
                                        tabIndex={0}
                                        title={`调整${column.label}；左右键微调；双击恢复推荐宽度`}
                                        className="column-resizer"
                                        data-dragging={dragRef.current?.label === column.label || undefined}
                                        onMouseEnter={() => {
                                            if (!dragRef.current) setActiveColumn(column.label);
                                        }}
                                        onMouseLeave={() => {
                                            if (!dragRef.current) setActiveColumn(null);
                                        }}
                                        onFocus={() => setActiveColumn(column.label)}
                                        onBlur={() => {
                                            if (!dragRef.current) setActiveColumn(null);
                                        }}
                                        onClick={event => event.stopPropagation()}
                                        onDoubleClick={() => restoreColumn(column.label)}
                                        onKeyDown={event => {
                                            if (!["ArrowLeft", "ArrowRight", "Home", "Escape"].includes(event.key))
                                                return;
                                            event.preventDefault();
                                            event.stopPropagation();
                                            if (event.key === "Escape") {
                                                finishDrag(true);
                                                return;
                                            }
                                            setActiveColumn(column.label);
                                            if (event.key === "Home") restoreColumn(column.label);
                                            else
                                                resize(
                                                    column.label,
                                                    widthOf(column) + (event.key === "ArrowRight" ? 16 : -16),
                                                );
                                        }}
                                        onPointerDown={event => {
                                            if (event.button !== 0) return;
                                            event.preventDefault();
                                            event.stopPropagation();
                                            event.currentTarget.focus({ preventScroll: true });
                                            event.currentTarget.setPointerCapture(event.pointerId);
                                            setActiveColumn(column.label);
                                            const draft = {
                                                ...preferences.widths,
                                                [column.label]: widthOf(column),
                                            };
                                            setDraftPreferences(draft);
                                            dragRef.current = {
                                                label: column.label,
                                                start: event.clientX,
                                                width: widthOf(column),
                                                base: draft,
                                                draft,
                                            };
                                        }}
                                        onPointerMove={event => {
                                            const drag = dragRef.current;
                                            if (drag?.label !== column.label) return;
                                            drag.draft = resizeTableColumn(
                                                visible,
                                                drag.base,
                                                column.label,
                                                drag.width + event.clientX - drag.start,
                                            );
                                            setDraftPreferences(drag.draft);
                                        }}
                                        onPointerUp={() => finishDrag()}
                                        onPointerCancel={() => finishDrag(true)}
                                        onLostPointerCapture={() => finishDrag()}
                                    />
                                ) : null;
                                const shared = {
                                    key: column.label,
                                    "data-pinned": pinned(column.index),
                                    // 最右一个 start 固定列承担固定区右边界（多列固定时与滚动区划界）
                                    "data-pinned-edge":
                                        column.index === lastStartIndex && startSet.size > 1 ? "start" : undefined,
                                    "aria-label": column.label,
                                    // 页面已写对齐类（left/center/right）时不再补默认左对齐，避免两类冲突
                                    className: `${column.header.props.className ?? ""} managed-th ${activeColumn === column.label ? "column-highlight" : ""} ${column.header.type !== SortTh && !column.header.props.className?.match(/text-(left|center|right)/) ? "text-left" : ""}`,
                                    style: startOffsets.has(column.index)
                                        ? { left: startOffsets.get(column.index) }
                                        : undefined,
                                    width: undefined,
                                };
                                const renderedHeader =
                                    column.header.type === SortTh
                                        ? cloneElement(column.header, { ...shared, resizeControl: control })
                                        : cloneElement(column.header, shared, column.header.props.children, control);
                                return (
                                    <Fragment key={column.label}>
                                        {hasFillColumn && index === visible.length - 1 && (
                                            <th
                                                aria-hidden="true"
                                                className="managed-th"
                                                data-table-fill=""
                                                style={{ padding: 0 }}
                                            />
                                        )}
                                        {renderedHeader}
                                    </Fragment>
                                );
                            })}
                        </tr>
                    </thead>
                    {sections
                        .filter(section => section.type !== "thead")
                        .map(section =>
                            cloneElement(
                                section,
                                {},
                                cells(section.props.children).map(row => {
                                    const rowCells = cells(row.props.children);
                                    const spansColumns = rowCells.some(cell => (cell.props.colSpan ?? 1) > 1);
                                    return cloneElement(
                                        row,
                                        {},
                                        rowCells.flatMap((cell, index) => {
                                            if ((cell.props.colSpan ?? 1) > 1)
                                                return cloneElement(cell, { colSpan: renderedColumnCount });
                                            const column = visible.find(column => column.index === index);
                                            if (!column) return [];
                                            const renderedCell = cloneElement(cell, {
                                                key: column.label,
                                                "data-pinned": pinned(column.index),
                                                "data-pinned-edge":
                                                    column.index === lastStartIndex && startSet.size > 1
                                                        ? "start"
                                                        : undefined,
                                                className: `${cell.props.className ?? ""} ${activeColumn === column.label ? "column-highlight" : ""}`,
                                                style: startOffsets.has(column.index)
                                                    ? { ...cell.props.style, left: startOffsets.get(column.index) }
                                                    : cell.props.style,
                                            } as CellProps);
                                            return hasFillColumn && !spansColumns && column.index === headers.length - 1
                                                ? [
                                                      <td
                                                          key="table-fill"
                                                          aria-hidden="true"
                                                          data-table-fill=""
                                                          style={{ padding: 0 }}
                                                      />,
                                                      renderedCell,
                                                  ]
                                                : renderedCell;
                                        }),
                                    );
                                }),
                            ),
                        )}
                </table>
            </div>
            <Modal
                open={settings}
                onClose={() => setSettings(false)}
                title="显示设置"
                subtitle="只影响当前账号在此浏览器中的显示。"
                width={520}
                footer={
                    <>
                        <button
                            type="button"
                            onClick={() => setPreferences(emptyPreferences())}
                            className="min-h-10 rounded-btn border border-line-strong px-4 text-14"
                        >
                            恢复推荐设置
                        </button>
                        <button
                            type="button"
                            onClick={() => setSettings(false)}
                            className="min-h-10 rounded-btn bg-primary px-4 text-14 text-white"
                        >
                            完成
                        </button>
                    </>
                }
            >
                <fieldset className="mb-5">
                    <legend className="mb-3 text-14 font-medium">每行显示多少信息</legend>
                    <div className="grid grid-cols-3 gap-2">
                        {(
                            [
                                ["compact", "紧凑"],
                                ["standard", "标准"],
                                ["roomy", "宽松"],
                            ] as const
                        ).map(([density, label]) => (
                            <label
                                key={density}
                                className={`flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border text-14 ${preferences.density === density ? "border-primary-border bg-primary-soft text-primary-strong" : "border-line"}`}
                            >
                                <input
                                    type="radio"
                                    name={`${storageKey}-density`}
                                    checked={preferences.density === density}
                                    onChange={() => setPreferences(current => ({ ...current, density }))}
                                />
                                {label}
                            </label>
                        ))}
                    </div>
                </fieldset>
                <h3 className="mb-2 text-14 font-medium">显示哪些内容</h3>
                <div className="space-y-1">
                    {columns.map(column => (
                        <div
                            key={column.label}
                            className="flex items-center justify-between gap-3 border-b border-line py-2"
                        >
                            <label className="flex min-h-10 flex-1 cursor-pointer items-center gap-2 text-14">
                                <input
                                    type="checkbox"
                                    checked={column.locked || !preferences.hidden.includes(column.label)}
                                    disabled={column.locked}
                                    onChange={event =>
                                        setPreferences(current => ({
                                            ...current,
                                            hidden: event.target.checked
                                                ? current.hidden.filter(label => label !== column.label)
                                                : [...current.hidden, column.label],
                                        }))
                                    }
                                />
                                {column.label}
                            </label>
                            {column.fixed ? (
                                <span className="text-13 text-muted">始终显示</span>
                            ) : (
                                <select
                                    aria-label={`${column.label}的宽窄`}
                                    disabled={preferences.hidden.includes(column.label) && !column.locked}
                                    value={preferences.widths[column.label] === undefined ? "recommended" : "custom"}
                                    onChange={event => {
                                        if (event.target.value === "recommended") restoreColumn(column.label);
                                        else
                                            resize(
                                                column.label,
                                                widthOf(column) + (event.target.value === "wider" ? 80 : -48),
                                            );
                                    }}
                                    className="min-h-9 rounded-md border border-line-strong bg-surface px-2 text-13"
                                >
                                    <option value="recommended">推荐宽度</option>
                                    <option value="narrower">窄一些</option>
                                    <option value="wider">宽一些</option>
                                    {preferences.widths[column.label] !== undefined && (
                                        <option value="custom">已手动调整</option>
                                    )}
                                </select>
                            )}
                        </div>
                    ))}
                </div>
            </Modal>
        </div>
    );
}
