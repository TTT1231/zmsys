import { useEffect, useId, useState, type ReactNode } from "react";
import { useIsMobile, useMediaQuery } from "@/lib/useIsMobile";
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
    openPanelValue?: string;
    visibleWhen?: { key: string; value: string };
    summary?: boolean;
    onChange: (value: string) => void;
}

export function MobileListControls({
    fields = [],
    more = [],
    action,
    validate,
    onApply,
}: {
    fields?: MobileFilterField[];
    more?: MobileFilterField[];
    action?: ReactNode;
    validate?: (draft: Record<string, string>) => string | undefined;
    onApply?: (draft: Record<string, string>) => void;
}) {
    const id = useId();
    const isMobile = useIsMobile();
    const narrow = useMediaQuery("(max-width: 359px)");
    const [draft, setDraft] = useState<Record<string, string> | null>(null);
    const [error, setError] = useState("");
    // 最窄的手机将名称较长的条件收进面板，选中后完整回显，给常用条件和主操作留出空间。
    const foldCandidate =
        fields.length > 1 ? fields.find(field => field.key === "category" || field.key === "domain") : undefined;
    // 旋转手机时保留已打开面板中的条件，避免正在编辑的内容突然消失。
    const foldedField = foldCandidate && (narrow || (draft && foldCandidate.key in draft)) ? foldCandidate : undefined;
    const inlineFields = fields.filter(field => field !== foldedField);
    const panelFields = foldedField ? [foldedField, ...more] : more;
    useEffect(() => {
        if (!isMobile) setDraft(null);
    }, [isMobile]);
    const values = Object.fromEntries(panelFields.map(field => [field.key, field.value]));
    const active = panelFields.filter(
        field =>
            field.summary !== false &&
            field.value !== field.defaultValue &&
            (!field.visibleWhen || values[field.visibleWhen.key] === field.visibleWhen.value),
    );
    const open = (overrides: Record<string, string> = {}) => {
        setError("");
        setDraft({ ...values, ...overrides });
    };
    const apply = () => {
        if (!draft) return;
        const next = Object.fromEntries(panelFields.map(field => [field.key, draft[field.key] ?? field.value]));
        const message = validate?.(next);
        if (message) {
            setError(message);
            return;
        }
        if (onApply) onApply(next);
        else for (const field of panelFields) field.onChange(next[field.key]!);
        setDraft(null);
    };

    if (!isMobile) return null;
    return (
        <div className="lg:hidden">
            <div className="mobile-list-controls">
                {inlineFields.map(field => (
                    <ToolbarSelect
                        key={field.key}
                        label={field.label}
                        value={field.value}
                        onChange={value => {
                            if (field.openPanelValue === value) open({ [field.key]: value });
                            else field.onChange(value);
                        }}
                        options={field.options ?? []}
                        className="min-w-0 flex-1 px-2"
                    />
                ))}
                {panelFields.length > 0 && (
                    <Button
                        variant="secondary"
                        aria-label={active.length ? `筛选，已选 ${active.length} 项` : "筛选"}
                        onClick={() => open()}
                        className="relative shrink-0 px-3"
                    >
                        筛选
                        {active.length > 0 && (
                            <span
                                aria-hidden="true"
                                className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-11 text-white"
                            >
                                {active.length}
                            </span>
                        )}
                    </Button>
                )}
                {action}
            </div>
            {active.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-b border-line px-3 pb-2" aria-label="已选筛选条件">
                    {active.map(field => {
                        const selected = field.options?.find(
                            option => typeof option !== "string" && option.value === field.value,
                        );
                        const text = selected && typeof selected !== "string" ? selected.label : field.value;
                        return (
                            <Button
                                key={field.key}
                                variant="ghost"
                                onClick={() => field.onChange(field.defaultValue)}
                                aria-label={`清除${field.label}筛选`}
                                className="min-h-11 max-w-full gap-2 bg-soft px-2.5 text-13 text-td"
                            >
                                <span className="min-w-0 wrap-anywhere text-left">
                                    {field.label}：{text}
                                </span>
                                <span aria-hidden="true">×</span>
                            </Button>
                        );
                    })}
                </div>
            )}
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
                                setDraft(Object.fromEntries(panelFields.map(field => [field.key, field.defaultValue])));
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
                    {panelFields
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
                                        onChange={event =>
                                            setDraft(current => ({ ...current, [field.key]: event.target.value }))
                                        }
                                        aria-invalid={!!error}
                                        aria-describedby={error ? `${id}-error` : undefined}
                                        className="min-h-11 w-full min-w-0 rounded-input border border-line-strong bg-surface px-3 text-16 font-normal"
                                    />
                                ) : (
                                    <ToolbarSelect
                                        label={field.label}
                                        value={draft?.[field.key] ?? field.value}
                                        onChange={value => setDraft(current => ({ ...current, [field.key]: value }))}
                                        options={field.options ?? []}
                                        className="w-full min-w-0 font-normal"
                                    />
                                )}
                            </label>
                        ))}
                    {error && (
                        <p id={`${id}-error`} role="alert" className="text-14 text-danger">
                            {error}
                        </p>
                    )}
                </form>
            </Modal>
        </div>
    );
}
