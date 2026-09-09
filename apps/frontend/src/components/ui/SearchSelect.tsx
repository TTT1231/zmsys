import { useId, useState } from "react";

// Native select retains keyboard and screen-reader behavior; search narrows long inventories.
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
    const [query, setQuery] = useState("");
    const id = useId();
    const results = options.filter(
        option => option.value === value || option.label.toLowerCase().includes(query.trim().toLowerCase()),
    );
    return (
        <div className="min-w-0">
            <label htmlFor={id} className="mb-1 block text-14 font-medium">
                {label}
                {required && <span className="text-danger"> *</span>}
            </label>
            <input
                aria-label={`搜索${label}`}
                type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={`搜索${label}`}
                className="mb-2 min-h-11 w-full rounded-btn border border-line-strong px-3 text-14"
            />
            <select
                id={id}
                required={required}
                value={value}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={event => onChange(event.target.value)}
                className="min-h-11 w-full rounded-btn border border-line-strong bg-white px-3 text-14"
            >
                <option value="">{results.length ? `请选择${label}` : "没有匹配结果，请调整搜索"}</option>
                {results.map(option => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
            {error && (
                <p id={`${id}-error`} role="alert" className="mt-1 text-13 text-danger">
                    {error}
                </p>
            )}
        </div>
    );
}
