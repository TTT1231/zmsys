import { cn } from "@/lib/utils";

/** 与浏览器标签共用同一枚「茂」字标识；应用内方块走 --color-brand（跟随主题预设，
    暗色提亮一档）。登录页渐变横幅是固定底色不随主题变，传 followTheme={false} 锁经典品牌蓝。 */
export function BrandLogo({
    className,
    decorative = false,
    followTheme = true,
}: {
    className?: string;
    decorative?: boolean;
    followTheme?: boolean;
}) {
    return (
        <svg
            viewBox="0 0 30 30"
            width={30}
            height={30}
            role={decorative ? undefined : "img"}
            aria-hidden={decorative || undefined}
            aria-label={decorative ? undefined : "众茂生产系统"}
            className={cn("block size-7.5 shrink-0", className)}
        >
            {/* 明暗走 View Transition 圆形扩散，预设切换是直切——fill 自带 300ms 过渡兜底平滑 */}
            <rect
                width="30"
                height="30"
                rx="8"
                className={`transition-[fill] duration-300 ${followTheme ? "fill-brand" : "fill-brand-classic"}`}
            />
            <text
                x="15"
                y="15.5"
                fill="#fff"
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="Microsoft YaHei UI, Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif"
                fontSize="17"
                fontWeight="600"
            >
                茂
            </text>
        </svg>
    );
}
