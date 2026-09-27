import { cn } from "@/lib/utils";

/** 与浏览器标签共用同一枚「茂」字标识，品牌蓝不随界面主题变化。 */
export function BrandLogo({ className, decorative = false }: { className?: string; decorative?: boolean }) {
    return (
        <img
            src="/favicon.svg"
            width={30}
            height={30}
            alt={decorative ? "" : "众茂生产系统"}
            aria-hidden={decorative || undefined}
            className={cn("block size-7.5 shrink-0", className)}
        />
    );
}
