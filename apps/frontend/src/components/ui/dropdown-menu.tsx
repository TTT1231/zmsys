import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

/* 基于 Radix 的下拉菜单（shadcn dropdown-menu 裁剪版，样式映射项目 token）：
   键盘导航 / 焦点管理 / 外点关闭 / aria 由 Radix 提供 */

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export function DropdownMenuContent({
    className,
    sideOffset = 6,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
    return (
        <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content
                sideOffset={sideOffset}
                className={cn(
                    "z-50 min-w-44 overflow-hidden rounded-card border border-line bg-white p-1.5 shadow-modal",
                    "data-[state=open]:animate-fade-in",
                    className,
                )}
                {...props}
            />
        </DropdownMenuPrimitive.Portal>
    );
}

export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
    return (
        <DropdownMenuPrimitive.Item
            className={cn(
                "flex min-h-10 max-lg:min-h-[44px] cursor-pointer select-none items-center gap-2.5 rounded-btn px-2.5 text-13 text-ink outline-none transition",
                "data-[highlighted]:bg-soft data-[highlighted]:text-ink",
                "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                className,
            )}
            {...props}
        />
    );
}

export function DropdownMenuRadioItem({
    className,
    children,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
    return (
        <DropdownMenuPrimitive.RadioItem
            className={cn(
                "relative flex min-h-10 max-lg:min-h-11 cursor-pointer select-none items-center rounded-btn py-2 pr-2.5 pl-8 text-13 text-ink outline-none transition",
                "data-[highlighted]:bg-soft data-[highlighted]:text-ink",
                "data-[state=checked]:bg-primary-soft/70 data-[state=checked]:font-medium data-[state=checked]:text-primary-strong",
                "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                className,
            )}
            {...props}
        >
            <DropdownMenuPrimitive.ItemIndicator className="absolute left-2.5 flex items-center text-primary">
                <span className="size-1.5 rounded-full bg-current" />
            </DropdownMenuPrimitive.ItemIndicator>
            {children}
        </DropdownMenuPrimitive.RadioItem>
    );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
    return (
        <DropdownMenuPrimitive.Label
            className={cn("px-2.5 py-2 text-13 font-semibold text-ink", className)}
            {...props}
        />
    );
}

export function DropdownMenuSeparator({
    className,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
    return <DropdownMenuPrimitive.Separator className={cn("my-1.5 h-px bg-line", className)} {...props} />;
}
