import type {
    ApplyBomStructureInput,
    BomStructureApplyResult,
    BomStructureCategoryCreated,
    CreateBomCategoryInput,
} from "./types";
import { requestClient } from "@/http";
import { idempotencyConfig } from "./idempotency";

/** 维护既有品类的目录结构（仅超级管理员；生效口径见 openapi bom-structure tag） */
export function applyBomStructure(input: ApplyBomStructureInput): Promise<BomStructureApplyResult> {
    return requestClient.post<BomStructureApplyResult>("/bom-structure/apply", input, idempotencyConfig());
}

/** 新建简单品类（名称 + 编码前缀 + 整棵草稿树一次保存，仅超级管理员） */
export function createBomCategory(input: CreateBomCategoryInput): Promise<BomStructureCategoryCreated> {
    return requestClient.post<BomStructureCategoryCreated>("/bom-structure/categories", input, idempotencyConfig());
}

/** 删除品类（整支级联：BOM 档案、目录树、下属类型容器、取号序列；仅超级管理员）。
 *  已被订单/出入库引用的 BOM 会被服务端 409 阻断 */
export function deleteBomCategory(categoryKey: string): Promise<{ deleted: boolean; key: string }> {
    return requestClient.post<{ deleted: boolean; key: string }>(
        `/bom-structure/categories/${categoryKey}/delete`,
        {},
        idempotencyConfig(),
    );
}
