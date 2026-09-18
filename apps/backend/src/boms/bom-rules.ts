import { BadRequestException } from "@nestjs/common";
import { normalizeMaterialId } from "../common/bom-spec";

/**
 * BOM 物料选择校验（db-scheme.md §5）：品类目录（material_group/material_item）
 * 是可选物料与分组语义的唯一权威；所有组皆可不选，但整份 BOM 至少选 1 项；
 * 单选组（multi=0）最多 1 项；不存在旧规格体系的跨字段规则（6.3/4.8 同口径
 * 等组合约束已随预生成模式废除），同类部件互斥由单选分组结构表达。
 */

/** 目录可用物料（service 从品类聚合；数组顺序即建档 position 分配顺序） */
export interface CatalogEntry {
    materialId: bigint;
    groupKey: string;
    groupName: string;
    multi: boolean;
    name: string;
}

/** 校验通过的选中结果：snapshots 为建档冻结行（按目录顺序分配 position） */
export interface MaterialSelection {
    /** 规范化去重后的物料 id（hash 输入，顺序无关） */
    ids: string[];
    snapshots: Array<{
        materialId: bigint;
        groupKey: string;
        groupName: string;
        name: string;
        position: number;
    }>;
}

/**
 * 解析并校验选中集合：id 数字串规范化（BigInt 十进制，消除前导零双表示）、
 * 去重；物料必须属于当前品类目录（品类/分区/分组/物料均启用）；单选组最多
 * 1 项。position 按传入目录顺序（分区 → 组 → 物料的 sortOrder）冻结。
 */
export function resolveMaterialSelection(catalog: CatalogEntry[], ids: string[]): MaterialSelection {
    if (!Array.isArray(ids) || ids.length === 0) {
        throw new BadRequestException("请至少选择一项物料");
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

    const selectedIdSet = new Set(uniqueIds);
    const snapshots: MaterialSelection["snapshots"] = [];
    for (const entry of catalog) {
        if (!selectedIdSet.has(entry.materialId.toString())) {
            continue;
        }
        snapshots.push({
            materialId: entry.materialId,
            groupKey: entry.groupKey,
            groupName: entry.groupName,
            name: entry.name,
            position: snapshots.length + 1,
        });
    }
    return { ids: uniqueIds, snapshots };
}
