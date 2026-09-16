import type { Bom } from "@/api";

/** 固定宽度的成品物料预览：编码 + 品类 + 前 3 项物料，完整核对走详情。 */
export function BomCell({ bom, bomCode }: { bom?: Bom; bomCode: string }) {
    const items = bom?.items ?? [];
    const preview = items.slice(0, 3);
    return (
        <div className="w-64 min-w-0 max-w-full">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="tnum text-13 font-medium text-td wrap-anywhere">{bomCode}</span>
                {bom && <span className="text-12 text-muted">{bom.name}</span>}
            </div>
            {preview.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                    {preview.map(item => (
                        <li
                            key={item.materialId}
                            className="truncate text-13 leading-5 text-td"
                            title={`${item.groupName}：${item.name}`}
                        >
                            <span className="text-muted">{item.groupName}：</span>
                            {item.name}
                        </li>
                    ))}
                    {items.length > preview.length && <li className="text-12 text-muted">等 {items.length} 项物料</li>}
                </ul>
            )}
            {(!bom || items.length === 0) && (
                <p className="mt-1 truncate text-12 text-muted" title={bom?.spec}>
                    {bom?.spec?.trim() || "暂无物料信息"}
                </p>
            )}
        </div>
    );
}
