import { useId } from "react";
import { Icon } from "@/lib/icons";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "./dropdown-menu";

export interface SelectMenuOption {
    value: string;
    label: string;
}

export function SelectMenuField({
    label,
    value,
    placeholder,
    options,
    onValueChange,
    required,
    error,
}: {
    label: string;
    value: string;
    placeholder: string;
    options: SelectMenuOption[];
    onValueChange: (value: string) => void;
    required?: boolean;
    error?: string;
}) {
    const labelId = useId();
    const errorId = useId();
    const selectedLabel = options.find(option => option.value === value)?.label;

    return (
        <div className="min-w-0">
            <span id={labelId} className="mb-1 block text-12.5 font-medium text-td">
                {label}
                {required && <span className="ml-0.5 text-danger">*</span>}
            </span>
            <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        aria-labelledby={labelId}
                        aria-required={required}
                        aria-invalid={!!error}
                        aria-describedby={error ? errorId : undefined}
                        className="group flex min-h-10 w-full cursor-pointer items-center justify-between gap-3 rounded-input border border-line-strong bg-surface px-3 py-2 text-left text-13 text-ink transition hover:border-primary-border focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                    >
                        <span className={selectedLabel ? "truncate" : "truncate text-subtle"}>
                            {selectedLabel ?? placeholder}
                        </span>
                        <Icon
                            name="chevron-down"
                            size={16}
                            className="shrink-0 text-muted transition-transform group-data-[state=open]:rotate-180"
                        />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="start"
                    collisionPadding={16}
                    className="z-200 max-h-(--radix-dropdown-menu-content-available-height) w-(--radix-dropdown-menu-trigger-width) overflow-y-auto"
                    onEscapeKeyDown={event => event.stopPropagation()}
                >
                    <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
                        <DropdownMenuRadioItem value="" className="text-muted">
                            {placeholder}
                        </DropdownMenuRadioItem>
                        {options.map(option => (
                            <DropdownMenuRadioItem key={option.value} value={option.value}>
                                <span className="truncate">{option.label}</span>
                            </DropdownMenuRadioItem>
                        ))}
                    </DropdownMenuRadioGroup>
                </DropdownMenuContent>
            </DropdownMenu>
            {error && (
                <span id={errorId} role="alert" className="mt-1 block text-12 text-danger">
                    {error}
                </span>
            )}
        </div>
    );
}
