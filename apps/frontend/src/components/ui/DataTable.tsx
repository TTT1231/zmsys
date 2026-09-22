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
import { useContentMaximize } from "@/context/useContentMaximize";
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
    recordCount,
    scrollRef,
    scrollClassName = "",
    storageKey,
}: DataTableProps & { storageKey: string }) {
    const bodyRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState(0);
    const { maximized } = useContentMaximize();
    // 翻到尾页只剩几行时卡片高度塌陷、分页条猛地上跳；记住本会话见过的满页表高，
    // 短页用最小高度兜底，翻页时高度保持稳定。
    const [minBodyHeight, setMinBodyHeight] = useState(0);
    const [preferences, setPreferences] = useState(() => readPreferences(storageKey));
    const [settings, setSettings] = useState(false);
    const [activeColumn, setActiveColumn] = useState<string | null>(null);
    const [draftPreferences, setDraftPreferences] = useState<Record<string, number> | null>(null);
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
    const columns = headers.map((header, index) => {
        const label = header.props.label ?? labelOf(header.props.children);
        const width = defaultWidths[index] ?? 160;
        const grow = /BOM|成品|物料构成|客户信息/.test(label) && width >= 220;
        const minimum = grow
            ? Math.min(width, 280)
            : index === identityColumn
              ? 150
              : /日期|数量/.test(label)
                ? 120
                : 100;
        return {
            header,
            index,
            label,
            key: label,
            width,
            min: Math.min(width, minimum),
            max: 800,
            grow,
            fixed: index === headers.length - 1,
            locked: index === identityColumn || index === headers.length - 1,
        };
    });
    const visible = columns.filter(column => column.locked || !preferences.hidden.includes(column.label));
    const widths = fitTableWidths(visible, draftPreferences ?? preferences.widths, viewport);
    const widthOf = (column: (typeof columns)[number]) => widths[column.label] ?? column.width;
    const totalWidth = visible.reduce((sum, column) => sum + widthOf(column), 0);
    // 自动列达到上限或全部被用户锁定时，以无语义弹性列补齐，并把固定操作列留在最右侧。
    const fillWidth = Math.max(0, viewport - totalWidth);
    const hasFillColumn = fillWidth > 0;
    const renderedColumnCount = visible.length + (hasFillColumn ? 1 : 0);
    const pinned = (index: number) =>
        index === identityColumn ? "start" : index === headers.length - 1 ? "end" : undefined;
    useImperativeHandle(scrollRef, () => bodyRef.current!, []);
    useLayoutEffect(() => {
        const element = bodyRef.current;
        if (!element) return;
        const measure = () => setViewport(current => (current === element.clientWidth ? current : element.clientWidth));
        measure();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
        observer?.observe(element);
        window.addEventListener("resize", measure);
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, []);
    // 最大化时高度由视口撑起而非内容，不参与记忆，避免退出后短页残留整屏高度。
    useLayoutEffect(() => {
        const element = bodyRef.current;
        if (!element || maximized) return;
        const height = element.scrollHeight;
        if (height > 0) setMinBodyHeight(current => (height > current ? height : current));
    });
    // 密度换挡后行高整体变化，重记基准高度，避免紧凑档残留宽松档的大段空白。
    useEffect(() => {
        setMinBodyHeight(0);
    }, [preferences.density]);
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
            data-resizing={!!draftPreferences || undefined}
        >
            <div className="table-display-toolbar">
                <span className="text-12 text-muted" role="status">
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
            <div
                ref={bodyRef}
                className={`managed-table-body overflow-x-auto ${scrollClassName}`}
                style={{ minHeight: maximized || !minBodyHeight ? undefined : minBodyHeight }}
            >
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
                                    "aria-label": column.label,
                                    // 页面已写对齐类（left/center/right）时不再补默认左对齐，避免两类冲突
                                    className: `${column.header.props.className ?? ""} managed-th ${activeColumn === column.label ? "column-highlight" : ""} ${column.header.type !== SortTh && !column.header.props.className?.match(/text-(left|center|right)/) ? "text-left" : ""}`,
                                    style: undefined,
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
                                                "data-pinned": pinned(index),
                                                className: `${cell.props.className ?? ""} ${activeColumn === column.label ? "column-highlight" : ""}`,
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
                            className="min-h-10 rounded-btn border border-line-strong px-4 text-13"
                        >
                            恢复推荐设置
                        </button>
                        <button
                            type="button"
                            onClick={() => setSettings(false)}
                            className="min-h-10 rounded-btn bg-primary px-4 text-13 text-white"
                        >
                            完成
                        </button>
                    </>
                }
            >
                <fieldset className="mb-5">
                    <legend className="mb-3 text-13 font-medium">每行显示多少信息</legend>
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
                                className={`flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border text-13 ${preferences.density === density ? "border-primary-border bg-primary-soft text-primary-strong" : "border-line"}`}
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
                <h3 className="mb-2 text-13 font-medium">显示哪些内容</h3>
                <div className="space-y-1">
                    {columns.map(column => (
                        <div
                            key={column.label}
                            className="flex items-center justify-between gap-3 border-b border-line py-2"
                        >
                            <label className="flex min-h-10 flex-1 cursor-pointer items-center gap-2 text-13">
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
                                <span className="text-12 text-muted">始终显示</span>
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
                                    className="min-h-9 rounded-md border border-line-strong bg-surface px-2 text-12"
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
