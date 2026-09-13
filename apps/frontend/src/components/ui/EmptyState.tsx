import type { ReactNode } from "react";

interface EmptyStateProps {
    /** 空态描述文案,不传则只显示插画 */
    description?: string;
    /** 插画尺寸(px);整页列表用默认 160,工作台明细等小面板表格用 120 */
    imageSize?: number;
    /** 描述下方的操作区(按需传入按钮) */
    children?: ReactNode;
}

/* B2B SaaS 风格空态:等距开放纸箱插画 + 描述 + 可选操作。表格与列表的无数据状态统一走这里 */
export function EmptyState({ description, imageSize = 160, children }: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center gap-3 text-center">
            <EmptyArt size={imageSize} />
            {description && <p className="text-13 text-muted">{description}</p>}
            {children}
        </div>
    );
}

/* 空数据插画:对称等距开放纸箱(参照 iconfont 开箱图标重绘)。
   三个面用带 indigo 色调的灰阶区分受光面,箱内冒出 indigo 新芽作唯一点缀色,居中无倾斜 */
function EmptyArt({ size }: { size: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 160 160" fill="none" aria-hidden="true">
            {/* 地面投影 */}
            <ellipse cx="80" cy="141" rx="52" ry="6.5" fill="#F1F3F8" />
            {/* 箱内:开口内壁 + 更深的箱底,营造纵深 */}
            <polygon points="80,52 122,74 80,96 38,74" fill="#CBD3E6" />
            <polygon points="80,64 110,79 80,94 50,79" fill="#B9C3DC" />
            {/* 箱体:左面受光、右面背光 */}
            <polygon points="38,74 80,96 80,132 38,110" fill="#E9EDF6" />
            <polygon points="80,96 122,74 122,110 80,132" fill="#DBE1F0" />
            {/* 向外翻开的封盖 */}
            <polygon points="38,74 80,96 66,114 24,92" fill="#F3F5FB" />
            <polygon points="80,96 122,74 136,92 94,114" fill="#E1E7F3" />
            {/* 箱内冒出的新芽(indigo 点缀) */}
            <path d="M80 68C78 60 78 54 80 46" stroke="#818CF8" strokeWidth="3" strokeLinecap="round" />
            <path d="M80 58C71 56 65 49 65 41C74 43 79 50 80 58Z" fill="#A5B4FC" />
            <path d="M80 50C89 48 95 41 95 33C86 35 81 42 80 50Z" fill="#C7D2FE" />
            {/* 漂浮几何点缀 */}
            <circle cx="34" cy="40" r="3.5" fill="#E0E7FF" />
            <circle cx="126" cy="48" r="2.5" fill="#C7D2FE" />
            <path d="M30 106v8M26 110h8" stroke="#DCE1EC" strokeWidth="2.5" strokeLinecap="round" />
            <rect x="119" y="112" width="9" height="9" rx="2.5" transform="rotate(12 123.5 116.5)" fill="#E8EBF2" />
        </svg>
    );
}
