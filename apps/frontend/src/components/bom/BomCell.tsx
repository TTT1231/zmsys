import { bomComposition } from "@/data/bomComposition";
import type { Bom, BomCategory } from "@/api";
import { bomSummary } from "@/data/bomSummary";
import { BomSpecs } from "./BomSpecs";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";

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
    const [open, setOpen] = useState(false);
    const composition = bom ? bomComposition(bom, categories) : undefined;
    const summary = bom ? bomSummary(bom) : "暂无物料信息";
    return (
        <div className="bom-cell min-w-0 text-left" data-identity={showIdentity}>
            {showIdentity && (
                <div className="flex min-w-0 items-center gap-2">
                    {bom ? (
                        <button
                            type="button"
                            onClick={() => setOpen(true)}
                            aria-label={`查看 ${bomCode} 的规格与物料`}
                            className="shrink-0 tnum text-13 font-semibold whitespace-nowrap text-primary-strong underline-offset-2 hover:underline"
                        >
                            {bomCode}
                        </button>
                    ) : (
                        <span className="tnum text-13 font-medium whitespace-nowrap text-td">{bomCode}</span>
                    )}
                    {bom && (
                        <span className="truncate text-12 text-muted" title={bom.name}>
                            {bom.name}
                        </span>
                    )}
                </div>
            )}
            {composition?.composite && (
                <p className="bom-composite mt-1 text-12 font-medium text-primary-strong">
                    微动组件：{composition.series}
                </p>
            )}
            <p className="bom-summary mt-1 text-12 leading-5 text-muted" title={summary}>
                {summary}
            </p>
            {!!bom?.items?.length && (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="bom-material-trigger mt-1 w-fit text-12 text-primary-strong underline-offset-2 hover:underline"
                >
                    查看物料（{bom.items.length}）
                </button>
            )}
            {bom && (
                <Modal
                    open={open}
                    onClose={() => setOpen(false)}
                    title={bomCode}
                    label="规格与物料"
                    width={560}
                    layout="detail"
                >
                    <BomSpecs bom={bom} categories={categories} />
                </Modal>
            )}
        </div>
    );
}
