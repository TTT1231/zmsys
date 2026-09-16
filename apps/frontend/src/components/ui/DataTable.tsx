import {
    Children,
    cloneElement,
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
import { useApp } from "@/context/AppContext";
import { Modal } from "./Modal";
import { SortTh } from "./SortTh";
import { fitTableWidths, resizeTablePair } from "@/lib/tableColumns";

interface CellProps {
    children?: ReactNode;
    label?: string;
    className?: string;
    style?: React.CSSProperties;
    colSpan?: number;
    width?: string;
    resizeControl?: ReactNode;
}
interface Preferences {
    widths: Record<string, number>;
    hidden: string[];
    compact: boolean;
}
interface DataTableProps {
    /** 仅接受单层表头和普通 tbody 行；表头文字同时作为稳定列标识。 */
    children: ReactNode;
    tableId: string;
    defaultWidths: number[];
    identityColumn?: number;
    scrollRef?: Ref<HTMLDivElement>;
    scrollClassName?: string;
}
const emptyPreferences = (): Preferences => ({ widths: {}, hidden: [], compact: false });
const cells = (children: ReactNode) => Children.toArray(children).filter(isValidElement) as ReactElement<CellProps>[];
const labelOf = (node: ReactNode): string =>
    Children.toArray(node)
        .map(child => (isValidElement<CellProps>(child) ? labelOf(child.props.children) : String(child)))
        .join("")
        .trim();
const clampWidth = (width: number) => Math.min(640, Math.max(96, Math.round(width)));

function readPreferences(key: string): Preferences {
    try {
        const saved = JSON.parse(localStorage.getItem(key) ?? "null");
        if (!saved || typeof saved !== "object") return emptyPreferences();
        return {
            compact: saved.compact === true,
            hidden: Array.isArray(saved.hidden) ? saved.hidden.filter((item: unknown) => typeof item === "string") : [],
            widths: Object.fromEntries(
                Object.entries(saved.widths ?? {})
                    .filter(
                        (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]),
                    )
                    .map(([label, width]) => [label, clampWidth(width)]),
            ),
        };
    } catch {
        return emptyPreferences();
    }
}

/** 各业务页保留自己的单元格与权限判断，只共用表格显示偏好。 */
export function DataTable(props: DataTableProps) {
    const { user } = useApp();
    const storageKey = `zm-table:v1:${user?.account ?? "guest"}:${props.tableId}`;
    return <TableView key={storageKey} {...props} storageKey={storageKey} />;
}

function TableView({
    children,
    defaultWidths,
    identityColumn = 0,
    scrollRef,
    scrollClassName = "max-h-[calc(100dvh-26rem)] min-h-60",
    storageKey,
}: DataTableProps & { storageKey: string }) {
    const headerRef = useRef<HTMLDivElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState({ width: 0, gutter: 0 });
    const [draftWidths, setDraftWidths] = useState<Record<string, number> | null>(null);
    const [resizing, setResizing] = useState<string | null>(null);
    const dragRef = useRef<{ label: string; start: number; width: number; widths: Record<string, number> } | null>(
        null,
    );
    const [preferences, setPreferences] = useState(() => readPreferences(storageKey));
    const [settings, setSettings] = useState(false);
    const sections = cells(children);
    const head = sections.find(section => section.type === "thead");
    const headRow = cells(head?.props.children)[0];
    const headers = cells(headRow?.props.children);
    const columns = headers.map((header, index) => {
        const label = header.props.label ?? labelOf(header.props.children);
        const width = defaultWidths[index] ?? 160;
        const minimum = /成品|物料构成/.test(label)
            ? 220
            : index === identityColumn
              ? 150
              : /日期|最近下单|数量/.test(label)
                ? 140
                : 120;
        return {
            header,
            index,
            label,
            key: label,
            width,
            min: Math.min(width, minimum),
            max: 640,
            fixed: index === headers.length - 1,
            locked: index === identityColumn || index === headers.length - 1,
        };
    });
    const visible = columns.filter(column => column.locked || !preferences.hidden.includes(column.label));
    const widths = draftWidths ?? fitTableWidths(visible, preferences.widths, viewport.width);
    const widthOf = (column: (typeof columns)[number]) => widths[column.label] ?? column.width;
    const totalWidth = visible.reduce((sum, column) => sum + widthOf(column), 0);
    useImperativeHandle(scrollRef, () => bodyRef.current!, []);
    useLayoutEffect(() => {
        const element = bodyRef.current;
        if (!element) return;
        const measure = () =>
            setViewport({ width: element.clientWidth, gutter: element.offsetWidth - element.clientWidth });
        measure();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
        observer?.observe(element);
        window.addEventListener("resize", measure);
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, []);
    const pinned = (index: number) =>
        index === identityColumn ? "start" : index === headers.length - 1 ? "end" : undefined;

    useEffect(() => {
        try {
            localStorage.setItem(storageKey, JSON.stringify(preferences));
        } catch {
            /* 存储受限时本次会话仍可使用。 */
        }
    }, [preferences, storageKey]);

    const resize = (label: string, desired: number) => {
        const next = resizeTablePair(visible, widths, label, desired);
        setPreferences(current => ({ ...current, widths: { ...current.widths, ...next } }));
    };
    const finishDrag = (cancel = false) => {
        if (!dragRef.current) return;
        if (!cancel && draftWidths)
            setPreferences(current => ({ ...current, widths: { ...current.widths, ...draftWidths } }));
        dragRef.current = null;
        setDraftWidths(null);
        setResizing(null);
    };
    const colgroup = (
        <colgroup>
            {visible.map(column => (
                <col key={column.label} style={{ width: widthOf(column) }} />
            ))}
        </colgroup>
    );

    return (
        <div className="managed-table" data-density={preferences.compact ? "compact" : "comfortable"}>
            <div className="flex min-h-10 items-center justify-between gap-3 border-b border-line bg-white px-5 py-1">
                <span className="text-12 text-subtle" role="status">
                    {resizing ? `${resizing}：${Math.round(widths[resizing])} px` : "拖动分隔线调整相邻列，操作列固定"}
                </span>
                <button
                    type="button"
                    onClick={() => setSettings(true)}
                    className="min-h-8 rounded-md px-2 text-12 font-medium text-primary-strong hover:bg-primary-soft"
                >
                    表格设置
                </button>
            </div>
            <div role="table" className="managed-table-grid">
                <div className="managed-table-header" style={{ paddingRight: viewport.gutter }}>
                    <div ref={headerRef} className="overflow-hidden">
                        <table
                            role="presentation"
                            className="data-table table-fixed border-separate border-spacing-0"
                            style={{ width: totalWidth }}
                        >
                            {colgroup}
                            <thead role="rowgroup">
                                <tr role="row" className={headRow?.props.className}>
                                    {visible.map((column, visibleIndex) => {
                                        const control =
                                            !column.fixed &&
                                            !visible[visibleIndex + 1]?.fixed &&
                                            visible[visibleIndex + 1] ? (
                                                <span
                                                    role="separator"
                                                    aria-orientation="vertical"
                                                    aria-label={`调整${column.label}列宽`}
                                                    aria-valuemin={column.min}
                                                    aria-valuemax={640}
                                                    aria-valuenow={Math.round(widthOf(column))}
                                                    tabIndex={0}
                                                    title="拖动调整；方向键微调；双击恢复此列"
                                                    className="column-resizer"
                                                    data-dragging={resizing === column.label || undefined}
                                                    onClick={event => event.stopPropagation()}
                                                    onDoubleClick={() => resize(column.label, column.width)}
                                                    onKeyDown={event => {
                                                        if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key))
                                                            return;
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        resize(
                                                            column.label,
                                                            event.key === "Home"
                                                                ? column.width
                                                                : widthOf(column) +
                                                                      (event.key === "ArrowRight" ? 16 : -16),
                                                        );
                                                    }}
                                                    onPointerDown={event => {
                                                        if (event.button !== 0) return;
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        event.currentTarget.focus({ preventScroll: true });
                                                        event.currentTarget.setPointerCapture(event.pointerId);
                                                        setDraftWidths(widths);
                                                        setResizing(column.label);
                                                        dragRef.current = {
                                                            label: column.label,
                                                            start: event.clientX,
                                                            width: widths[column.label],
                                                            widths,
                                                        };
                                                    }}
                                                    onPointerMove={event => {
                                                        const drag = dragRef.current;
                                                        if (drag?.label === column.label)
                                                            setDraftWidths(
                                                                resizeTablePair(
                                                                    visible,
                                                                    drag.widths,
                                                                    column.label,
                                                                    drag.width + event.clientX - drag.start,
                                                                ),
                                                            );
                                                    }}
                                                    onPointerUp={() => finishDrag()}
                                                    onPointerCancel={() => finishDrag(true)}
                                                    onLostPointerCapture={() => finishDrag()}
                                                />
                                            ) : null;
                                        const shared = {
                                            key: column.label,
                                            role: "columnheader",
                                            "data-pinned": pinned(column.index),
                                            "aria-label": column.label,
                                            className: `${column.header.props.className ?? ""} managed-th ${column.header.type !== SortTh && !column.header.props.className?.includes("text-right") ? "text-left" : ""}`,
                                            style: undefined,
                                            width: undefined,
                                        };
                                        return column.header.type === SortTh
                                            ? cloneElement(column.header, { ...shared, resizeControl: control })
                                            : cloneElement(
                                                  column.header,
                                                  shared,
                                                  column.header.props.children,
                                                  control,
                                              );
                                    })}
                                </tr>
                            </thead>
                        </table>
                    </div>
                </div>
                <div
                    ref={bodyRef}
                    className={`managed-table-body overflow-auto ${scrollClassName}`}
                    onScroll={event => {
                        if (headerRef.current) headerRef.current.scrollLeft = event.currentTarget.scrollLeft;
                    }}
                >
                    <table
                        role="presentation"
                        className="data-table table-fixed border-separate border-spacing-0"
                        style={{ width: totalWidth }}
                    >
                        {colgroup}
                        {sections
                            .filter(section => section.type !== "thead")
                            .map(section =>
                                cloneElement(
                                    section,
                                    { role: "rowgroup" } as CellProps,
                                    cells(section.props.children).map(row =>
                                        cloneElement(
                                            row,
                                            { role: "row" } as CellProps,
                                            cells(row.props.children).map((cell, index) => {
                                                if ((cell.props.colSpan ?? 1) > 1)
                                                    return cloneElement(cell, {
                                                        colSpan: visible.length,
                                                        role: "cell",
                                                    } as CellProps);
                                                if (!visible.some(column => column.index === index)) return null;
                                                return cloneElement(cell, {
                                                    "data-pinned": pinned(index),
                                                    role: "cell",
                                                } as CellProps);
                                            }),
                                        ),
                                    ),
                                ),
                            )}
                    </table>
                </div>
            </div>
            <Modal
                open={settings}
                onClose={() => setSettings(false)}
                title="表格设置"
                subtitle="仅影响当前账号在此浏览器中的显示，不改变数据或权限。"
                width={540}
                footer={
                    <>
                        <button
                            type="button"
                            onClick={() => setPreferences(emptyPreferences())}
                            className="min-h-10 rounded-btn border border-line-strong px-4 text-13"
                        >
                            恢复默认
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
                    <legend className="mb-2 text-13 font-medium">显示密度</legend>
                    <div className="flex gap-4">
                        {[false, true].map(compact => (
                            <label
                                key={String(compact)}
                                className="flex min-h-10 cursor-pointer items-center gap-2 text-13"
                            >
                                <input
                                    type="radio"
                                    name={`${storageKey}-density`}
                                    checked={preferences.compact === compact}
                                    onChange={() => setPreferences(current => ({ ...current, compact }))}
                                />
                                {compact ? "紧凑" : "舒适"}
                            </label>
                        ))}
                    </div>
                </fieldset>
                <p className="mb-2 text-12 text-muted">
                    勾选显示的列；编号和操作列始终保留。数据列宽也可直接输入，操作列宽度固定。
                </p>
                <div className="space-y-2">
                    {columns.map(column => (
                        <div
                            key={column.label}
                            className="flex items-center justify-between gap-4 rounded-input bg-panel px-3 py-1.5"
                        >
                            <label className="flex min-h-9 flex-1 cursor-pointer items-center gap-2 text-13">
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
                                <span className="text-12 text-muted">固定 {column.width} px</span>
                            ) : (
                                <label className="flex items-center gap-1 text-12 text-muted">
                                    <input
                                        type="number"
                                        aria-label={`${column.label}列宽`}
                                        min={column.min}
                                        max={640}
                                        step={8}
                                        key={Math.round(widthOf(column))}
                                        defaultValue={Math.round(widthOf(column))}
                                        onBlur={event => {
                                            const value = Number(event.target.value);
                                            const width =
                                                event.target.value && Number.isFinite(value)
                                                    ? clampWidth(value)
                                                    : widthOf(column);
                                            event.target.value = String(width);
                                            resize(column.label, width);
                                        }}
                                        onKeyDown={event => {
                                            if (event.key === "Enter") event.currentTarget.blur();
                                        }}
                                        className="min-h-9 w-20 rounded-md border border-line-strong bg-white px-2 text-13 text-ink"
                                    />
                                    px
                                </label>
                            )}
                        </div>
                    ))}
                </div>
            </Modal>
        </div>
    );
}
