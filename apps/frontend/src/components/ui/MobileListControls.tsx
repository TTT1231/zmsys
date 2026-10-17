import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { ToolbarSelect } from "./ToolbarSelect";

export interface MobileFilterField {
    key: string;
    label: string;
    value: string;
    defaultValue: string;
    options?: Array<string | { value: string; label: string }>;
    type?: "date";
    visibleWhen?: { key: string; value: string };
    /** 日期等从属字段随范围一起计数，不重复计为独立条件。 */
    count?: boolean;
}

export function MobileListControls({
    fields,
    action,
    validate,
    onApply,
}: {
    fields: MobileFilterField[];
    action?: ReactNode;
    validate?: (draft: Record<string, string>) => string | undefined;
    onApply: (draft: Record<string, string>) => void;
}) {
    const id = useId();
    const isMobile = useIsMobile();
    const [draft, setDraft] = useState<Record<string, string> | null>(null);
    const [error, setError] = useState("");
    const toolbarRef = useRef<HTMLDivElement>(null);
    const errorRef = useRef<HTMLParagraphElement>(null);
    useEffect(() => {
        if (!isMobile) setDraft(null);
    }, [isMobile]);
    useEffect(() => {
        if (error) errorRef.current?.focus();
    }, [error]);
    const values = Object.fromEntries(fields.map(field => [field.key, field.value]));
    const defaults = Object.fromEntries(fields.map(field => [field.key, field.defaultValue]));
    const activeCount = fields.filter(
        field =>
            field.count !== false &&
            field.value !== field.defaultValue &&
            (!field.visibleWhen || values[field.visibleWhen.key] === field.visibleWhen.value),
    ).length;
    const open = () => {
        setError("");
        setDraft(values);
    };
    const apply = () => {
        if (!draft) return;
        const next = Object.fromEntries(fields.map(field => [field.key, draft[field.key] ?? field.value]));
        const message = validate?.(next);
        if (message) {
            setError(message);
            return;
        }
        onApply(next);
        setDraft(null);
    };

    if (!isMobile) return null;
    return (
        <div className="lg:hidden">
            <div ref={toolbarRef} className="mobile-list-controls">
                <Button
                    variant="secondary"
                    icon="sliders"
                    aria-label={activeCount ? `筛选，已选 ${activeCount} 项` : "筛选"}
                    aria-haspopup="dialog"
                    aria-expanded={draft !== null}
                    onClick={open}
                    className={`flex-1 whitespace-nowrap px-3 ${activeCount ? "border-primary-border bg-primary-soft text-primary-strong" : ""}`}
                >
                    筛选{activeCount > 0 && <span aria-hidden="true"> · {activeCount}</span>}
                </Button>
                {activeCount > 0 && (
                    <Button
                        variant="ghost"
                        aria-label="清空筛选"
                        onClick={() => {
                            onApply(defaults);
                            toolbarRef.current?.querySelector("button")?.focus();
                        }}
                        className="px-3"
                    >
                        清空
                    </Button>
                )}
                {action && <div className="flex min-w-0 flex-1 [&>button]:w-full">{action}</div>}
            </div>
            <Modal
                open={draft !== null}
                onClose={() => setDraft(null)}
                title="筛选"
                width={480}
                footer={
                    <>
                        <Button
                            variant="ghost"
                            onClick={() => {
                                setError("");
                                setDraft(defaults);
                            }}
                        >
                            重置
                        </Button>
                        <Button variant="secondary" onClick={() => setDraft(null)}>
                            取消
                        </Button>
                        <Button onClick={apply}>确认</Button>
                    </>
                }
            >
                <form
                    className="grid gap-4"
                    onSubmit={event => {
                        event.preventDefault();
                        apply();
                    }}
                >
                    <p className="text-13 text-muted">选择条件后，点击“确认”查看结果。</p>
                    {fields
                        .filter(
                            field => !field.visibleWhen || draft?.[field.visibleWhen.key] === field.visibleWhen.value,
                        )
                        .map(field => (
                            <label key={field.key} className="grid gap-1.5 text-14 font-medium text-ink">
                                {field.label}
                                {field.type === "date" ? (
                                    <input
                                        type="date"
                                        value={draft?.[field.key] ?? ""}
                                        onChange={event => {
                                            setError("");
                                            setDraft(current => ({ ...current, [field.key]: event.target.value }));
                                        }}
                                        aria-invalid={!!error}
                                        aria-describedby={error ? `${id}-error` : undefined}
                                        className="min-h-11 w-full min-w-0 rounded-input border border-line-strong bg-surface px-3 text-16 font-normal"
                                    />
                                ) : (
                                    <ToolbarSelect
                                        label={field.label}
                                        value={draft?.[field.key] ?? field.value}
                                        onChange={value => {
                                            setError("");
                                            setDraft(current => ({ ...current, [field.key]: value }));
                                        }}
                                        options={(field.options ?? []).map(option => {
                                            const value = typeof option === "string" ? option : option.value;
                                            const label = typeof option === "string" ? option : option.label;
                                            return {
                                                value,
                                                label:
                                                    value === field.defaultValue &&
                                                    (value === "all" || value.startsWith("全部"))
                                                        ? "全部"
                                                        : label,
                                            };
                                        })}
                                        className="w-full min-w-0 font-normal"
                                    />
                                )}
                            </label>
                        ))}
                    {error && (
                        <p ref={errorRef} id={`${id}-error`} role="alert" tabIndex={-1} className="text-14 text-danger">
                            {error}
                        </p>
                    )}
                </form>
            </Modal>
        </div>
    );
}
