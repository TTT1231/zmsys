import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const inputBase =
    "w-full rounded-[9px] border border-line-strong bg-white px-3 py-2 text-[13px] text-ink transition placeholder:text-subtle focus:border-primary focus:outline-none disabled:bg-[#f8fafc] disabled:text-subtle";

export function TextField({
    label,
    required,
    error,
    hint,
    ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
    label: string;
    required?: boolean;
    error?: string;
    hint?: string;
}) {
    return (
        <Field label={label} required={required} error={error} hint={hint}>
            <input aria-invalid={!!error} aria-required={required} {...rest} className={inputBase} />
        </Field>
    );
}

export function DateField({
    label,
    required,
    error,
    ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
    label: string;
    required?: boolean;
    error?: string;
}) {
    return (
        <Field label={label} required={required} error={error}>
            <input aria-invalid={!!error} aria-required={required} {...rest} type="date" className={inputBase} />
        </Field>
    );
}

export function SelectField({
    label,
    required,
    error,
    children,
    ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
    label: string;
    required?: boolean;
    error?: string;
}) {
    return (
        <Field label={label} required={required} error={error}>
            <select aria-invalid={!!error} aria-required={required} {...rest} className={inputBase}>
                {children}
            </select>
        </Field>
    );
}

export function TextArea({
    label,
    required,
    error,
    placeholder,
    ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
    label: string;
    required?: boolean;
    error?: string;
}) {
    return (
        <Field label={label} required={required} error={error}>
            <textarea
                aria-invalid={!!error}
                aria-required={required}
                {...rest}
                placeholder={placeholder}
                className={`${inputBase} min-h-18 resize-y`}
            />
        </Field>
    );
}

export function Field({
    label,
    required,
    error,
    hint,
    children,
}: {
    label: string;
    required?: boolean;
    error?: string;
    hint?: string;
    children: ReactNode;
}) {
    return (
        <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-td">
                {label}
                {required && <span className="ml-0.5 text-danger">*</span>}
            </span>
            {children}
            {error ? (
                <span role="alert" className="mt-1 block text-[12px] text-danger">
                    {error}
                </span>
            ) : hint ? (
                <span className="mt-1 block text-[12px] text-subtle">{hint}</span>
            ) : null}
        </label>
    );
}
