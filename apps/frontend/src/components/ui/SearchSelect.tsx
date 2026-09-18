import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

/** 搜索与选择合一；候选层保持输入焦点，避免被弹窗滚动区裁切。 */
export function SearchSelect({
    label,
    value,
    onChange,
    options,
    error,
    required,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    error?: string;
    required?: boolean;
}) {
    const id = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(-1);
    const [position, setPosition] = useState<CSSProperties>({ left: 0, top: 0, width: 0, maxHeight: 240 });
    const selected = options.find(option => option.value === value);
    const results = options.filter(option =>
        `${option.label} ${option.value}`.toLowerCase().includes(query.trim().toLowerCase()),
    );

    useEffect(() => {
        if (!open) return;
        const reposition = () => {
            const rect = inputRef.current?.getBoundingClientRect();
            if (!rect) return;
            const below = window.innerHeight - rect.bottom - 12;
            const above = rect.top - 12;
            const upwards = below < 180 && above > below;
            const maxHeight = Math.max(0, Math.min(280, upwards ? above : below));
            setPosition({
                left: rect.left,
                width: rect.width,
                ...(upwards ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
                maxHeight,
            });
        };
        reposition();
        window.addEventListener("resize", reposition);
        window.addEventListener("scroll", reposition, true);
        return () => {
            window.removeEventListener("resize", reposition);
            window.removeEventListener("scroll", reposition, true);
        };
    }, [open]);

    useEffect(() => {
        listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
    }, [active]);

    const close = () => {
        setOpen(false);
        setQuery("");
        setActive(-1);
    };
    const choose = (next: string) => {
        onChange(next);
        close();
    };

    return (
        <div className="min-w-0">
            <label htmlFor={id} className="mb-1 block text-14 font-medium">
                {label}
                {required && <span className="text-danger"> *</span>}
            </label>
            <input
                ref={inputRef}
                id={id}
                role="combobox"
                autoComplete="off"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={open ? `${id}-list` : undefined}
                aria-activedescendant={open && active >= 0 && results[active] ? `${id}-option-${active}` : undefined}
                aria-required={required}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
                value={open ? query : (selected?.label ?? "")}
                placeholder={`搜索并选择${label}`}
                onFocus={() => {
                    setQuery("");
                    setOpen(true);
                    setActive(-1);
                }}
                onClick={() => {
                    if (!open) {
                        setQuery("");
                        setOpen(true);
                        setActive(-1);
                    }
                }}
                onBlur={close}
                onChange={event => {
                    setQuery(event.target.value);
                    setOpen(true);
                    setActive(-1);
                    if (value) onChange("");
                }}
                onKeyDown={event => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === "Escape" && open) {
                        event.preventDefault();
                        event.stopPropagation();
                        close();
                    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        setOpen(true);
                        setActive(current =>
                            results.length
                                ? Math.max(
                                      0,
                                      Math.min(results.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)),
                                  )
                                : -1,
                        );
                    } else if (event.key === "Enter" && open) {
                        event.preventDefault();
                        if (active >= 0 && results[active]) choose(results[active].value);
                    }
                }}
                className="min-h-11 w-full rounded-input border border-line-strong bg-white px-3 text-14 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {open &&
                createPortal(
                    <div
                        ref={listRef}
                        style={position}
                        className="fixed z-200 overflow-y-auto overscroll-contain rounded-input border border-line bg-white p-1 shadow-modal"
                        onMouseDown={event => event.preventDefault()}
                    >
                        <p role="status" className="px-3 py-2 text-12 text-muted">
                            {results.length ? `${results.length} 个匹配结果，请选择` : `未找到匹配${label}，请调整搜索`}
                        </p>
                        <ul id={`${id}-list`} role="listbox" aria-label={`${label}搜索结果`}>
                            {results.map((option, index) => (
                                <li
                                    key={option.value}
                                    id={`${id}-option-${index}`}
                                    role="option"
                                    aria-selected={index === active}
                                    onMouseMove={() => setActive(index)}
                                    onClick={() => choose(option.value)}
                                    className={`cursor-pointer rounded-md px-3 py-2 text-13 ${index === active ? "bg-primary-soft text-primary-strong" : "text-ink hover:bg-soft"}`}
                                >
                                    <div className="break-words">{option.label}</div>
                                    {!option.label.includes(option.value) && (
                                        <div className="mt-0.5 text-12 text-muted">{option.value}</div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>,
                    document.body,
                )}
            {error && (
                <p id={`${id}-error`} role="alert" className="mt-1 text-13 text-danger">
                    {error}
                </p>
            )}
        </div>
    );
}
