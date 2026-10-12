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
