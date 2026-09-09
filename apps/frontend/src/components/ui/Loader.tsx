interface LoaderProps {
    /** 方块边长(px);容器自动预留弹跳与阴影空间 */
    size?: number;
    /** 有值时以 role=status 暴露给读屏,否则视为装饰由父容器语义覆盖 */
    label?: string;
    className?: string;
}

/* vben 式方块弹跳 loader:方块下落挤压变形旋转 + 地面阴影伸缩(0.5s 循环)。
   keyframes 用百分比单位(loader-jump-ani/loader-shadow-ani,见 index.css),任意尺寸自适应 */
export function Loader({ size = 24, label, className = "" }: LoaderProps) {
    return (
        <span
            role={label ? "status" : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
            className={`relative inline-block ${className}`}
            style={{ width: size, height: size * 1.35 }}
        >
            {/* 地面阴影:方块落下时横向拉宽 */}
            <span
                className="absolute right-0 bottom-0 left-0 mx-auto animate-[loader-shadow-ani_0.5s_linear_infinite] rounded-[50%] bg-primary/50"
                style={{ width: size, height: Math.max(2, Math.round(size * 0.1)) }}
            />
            {/* 弹跳方块 */}
            <span
                className="absolute top-0 left-0 animate-[loader-jump-ani_0.5s_linear_infinite] rounded-[12%] bg-primary"
                style={{ width: size, height: size }}
            />
        </span>
    );
}
