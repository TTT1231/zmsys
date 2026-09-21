import { Icon } from "@/lib/icons";

/**
 * BOM 备注（同编码成品的工艺差异说明）入库/发货时要一眼看到，
 * 用警示提示条呈现；文案只保留「BOM 备注：内容」，空值不渲染。
 */
export function BomRemarkNote({ remark, className = "" }: { remark?: string; className?: string }) {
    const text = remark?.trim();
    if (!text) return null;
    return (
        <div
            role="note"
            className={`flex gap-2.5 rounded-btn border border-warning/40 bg-warning-soft px-3 py-2.5 ${className}`}
        >
            <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-warning" />
            <p className="min-w-0 whitespace-pre-wrap text-12.5 leading-5 text-td">
                BOM 备注：<span className="font-medium">{text}</span>
            </p>
        </div>
    );
}
