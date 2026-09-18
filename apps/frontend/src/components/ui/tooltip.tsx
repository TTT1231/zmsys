import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

/* 基于 Radix 的轻量提示（shadcn tooltip 裁剪版）：hover / focus 触发，延迟与Dismiss 由 Provider 控制 */

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
    className,
    sideOffset = 6,
    children,
    ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
    return (
        <TooltipPrimitive.Portal>
            <TooltipPrimitive.Content
                sideOffset={sideOffset}
                className={cn(
                    "z-150 rounded-md bg-ink px-2.5 py-1.5 text-12 leading-none whitespace-nowrap text-white shadow-modal",
                    "data-[state=delayed-open]:animate-fade-in",
                    className,
                )}
                {...props}
            >
                {children}
            </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
    );
}
