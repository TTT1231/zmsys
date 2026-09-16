import { bomComposition } from "@/data/bomComposition";
import type { Bom, BomCategory } from "@/api";
import { bomSummary } from "@/data/bomSummary";
import { BomSpecs } from "./BomSpecs";

/** 列表显示关键规格，完整物料用显式展开入口核对。 */
export function BomCell({
    bom,
    bomCode,
    showIdentity = true,
    categories,
}: {
    bom?: Bom;
    bomCode: string;
    showIdentity?: boolean;
    categories?: BomCategory[];
}) {
    const composition = bom ? bomComposition(bom, categories) : undefined;
    const summary = bom ? bomSummary(bom) : "暂无物料信息";
    return (
        <div className="min-w-0 text-left">
            {showIdentity && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="tnum text-13 font-medium text-td wrap-anywhere">{bomCode}</span>
                    {bom && <span className="text-12 text-muted">{bom.name}</span>}
                </div>
            )}
            {composition?.composite && (
                <p className="mt-1 text-12 font-medium text-primary-strong">微动组件：{composition.series}</p>
            )}
            <p className="mt-1 line-clamp-2 text-12 leading-5 text-muted" title={summary}>
                {summary}
            </p>
            {!!bom?.items?.length && (
                <details className="mt-1">
                    <summary className="w-fit cursor-pointer text-12 text-primary-strong underline-offset-2 hover:underline">
                        查看物料（{bom.items.length}）
                    </summary>
                    <div className="mt-2 max-h-60 overflow-y-auto rounded-input border border-line bg-panel p-2">
                        <BomSpecs bom={bom} categories={categories} layout="list" showIdentity={false} />
                    </div>
                </details>
            )}
        </div>
    );
}
