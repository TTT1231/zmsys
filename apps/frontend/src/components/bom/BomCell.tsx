import { bomComposition } from "@/data/bomComposition";
import type { Bom, BomCategory } from "@/api";
import { bomSummary } from "@/data/bomSummary";
import { BomSpecs } from "./BomSpecs";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

/** 列表显示关键规格，完整物料用显式展开入口核对。 */
export function BomCell({
    bom,
    bomCode,
    showIdentity = true,
    showName = true,
    categories,
}: {
    bom?: Bom;
    bomCode: string;
    showIdentity?: boolean;
    /** 身份行是否内联品类名；品类已单独成列时关闭，避免重复（如库存页） */
    showName?: boolean;
    categories?: BomCategory[];
}) {
    const [open, setOpen] = useState(false);
    const composition = useMemo(() => (bom ? bomComposition(bom, categories) : undefined), [bom, categories]);
    const summary = useMemo(() => (bom ? bomSummary(bom) : "暂无物料信息"), [bom]);
    return (
        <div className="bom-cell min-w-0 text-left" data-identity={showIdentity}>
            {showIdentity && (
                <div className="flex min-w-0 items-center gap-2">
                    {bom ? (
                        <Button
                            variant="link"
                            onClick={() => setOpen(true)}
                            aria-label={`查看 ${bomCode} 的规格与物料`}
                            className="shrink-0 tnum font-semibold whitespace-nowrap"
                        >
                            {bomCode}
                        </Button>
                    ) : (
                        <span className="tnum text-14 font-medium whitespace-nowrap text-td">{bomCode}</span>
                    )}
                    {bom && showName && (
                        <span className="truncate text-13 text-muted" title={bom.name}>
                            {bom.name}
                        </span>
                    )}
                </div>
            )}
            {composition?.composite && (
                <p className="bom-composite mt-1 text-13 font-medium text-primary-strong">
                    {composition.childKind}：{composition.series}
                </p>
            )}
            <p className="bom-summary mt-1 text-13 leading-5 text-muted" title={summary}>
                {summary}
            </p>
            {!!bom?.items?.length && (
                <Button
                    variant="link"
                    onClick={() => setOpen(true)}
                    className="bom-material-trigger mt-1 w-fit text-13"
                >
                    查看物料（{bom.items.length}）
                </Button>
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
