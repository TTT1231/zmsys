import { BadRequestException } from "@nestjs/common";
import { BOM_ITEM_QTY_MAX, normalizeMaterialId } from "../common/bom-spec";

/**
 * BOM 物料选择校验（db-scheme.md §5）：品类目录（material_group/material_item）
 * 是可选物料与分组语义的唯一权威；所有组皆可不选，但整份 BOM 至少选 1 项；
 * 单选组（multi=0）最多 1 项；带数量组（qty=1，如琴键开关的扣板/连锁片/静片/
 * 动片）选中项可携带 1-99 的数量，其余组数量恒 1；不存在旧规格体系的跨字段
 * 规则（6.3/4.8 同口径等组合约束已随预生成模式废除），同类部件互斥由单选分组结构表达。
 */

/** 目录可用物料（service 从品类聚合；数组顺序即建档 position 分配顺序） */
export interface CatalogEntry {
    materialId: bigint;
    groupKey: string;
    groupName: string;
    multi: boolean;
    qty: boolean;
    name: string;
}

/** 校验通过的选中结果：snapshots 为建档冻结行（按目录顺序分配 position） */
export interface MaterialSelection {
    /** 规范化去重后的物料 id（展示用，顺序无关） */
    ids: string[];
    snapshots: Array<{
        materialId: bigint;
        groupKey: string;
        groupName: string;
        name: string;
        position: number;
        quantity: number;
    }>;
}

/**
 * 解析并校验选中集合：id 数字串规范化（BigInt 十进制，消除前导零双表示）、
 * 去重；物料必须属于当前品类目录（品类/分区/分组/物料均启用）；单选组最多
 * 1 项；数量仅 qty 分组的选中项允许 >1（1-99 整数），其余分组携带任何非 1
 * 数量均拒绝（避免静默改写造成前后端数量口径分歧）。position 按传入目录顺序
 * （分区 → 组 → 物料的 sortOrder）冻结。
 */
export function resolveMaterialSelection(
    catalog: CatalogEntry[],
    ids: string[],
    quantities: Record<string, unknown> = {},
): MaterialSelection {
    if (!Array.isArray(ids) || ids.length === 0) {
        throw new BadRequestException("请至少选择一项物料");
    }
    if (quantities === null || typeof quantities !== "object" || Array.isArray(quantities)) {
        throw new BadRequestException("物料数量表格式无效");
    }
    const normalized = ids.map(id => {
        const value = normalizeMaterialId(id);
        if (value === null) {
            throw new BadRequestException("物料编号格式无效");
        }
        return value;
    });
    const uniqueIds = [...new Set(normalized)];

    const entryById = new Map(catalog.map(entry => [entry.materialId.toString(), entry]));
    const selected = uniqueIds.map(id => {
        const entry = entryById.get(id);
        if (!entry) {
            throw new BadRequestException("物料不存在、已停用或不属于该品类");
        }
        return entry;
    });

    const bucketByGroup = new Map<string, { groupName: string; multi: boolean; count: number }>();
    for (const entry of selected) {
        const bucket = bucketByGroup.get(entry.groupKey) ?? {
            groupName: entry.groupName,
            multi: entry.multi,
            count: 0,
        };
        bucket.count += 1;
        bucketByGroup.set(entry.groupKey, bucket);
    }
    for (const { groupName, multi, count } of bucketByGroup.values()) {
        if (!multi && count > 1) {
            throw new BadRequestException(`分组「${groupName}」只能选择一项物料`);
        }
    }

    /* 数量校验：qty 分组接受 1-99；非 qty 分组只接受缺省或 1 */
    for (const entry of selected) {
        const raw = quantities[entry.materialId.toString()];
        if (raw === undefined) {
            continue;
        }
        if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > BOM_ITEM_QTY_MAX) {
            throw new BadRequestException(`物料「${entry.name}」数量须为 1-${BOM_ITEM_QTY_MAX} 的整数`);
        }
        if (!entry.qty && raw !== 1) {
            throw new BadRequestException(`分组「${entry.groupName}」的物料不带数量`);
        }
    }

    const selectedIdSet = new Set(uniqueIds);
    const snapshots: MaterialSelection["snapshots"] = [];
    for (const entry of catalog) {
        if (!selectedIdSet.has(entry.materialId.toString())) {
            continue;
        }
        const quantity = entry.qty ? Number(quantities[entry.materialId.toString()] ?? 1) : 1;
        snapshots.push({
            materialId: entry.materialId,
            groupKey: entry.groupKey,
            groupName: entry.groupName,
            name: entry.name,
            position: snapshots.length + 1,
            quantity,
        });
    }
    return { ids: uniqueIds, snapshots };
}
