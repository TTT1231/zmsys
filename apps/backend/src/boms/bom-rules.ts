import { BadRequestException } from '@nestjs/common';
import { fixedSpecsOf, type BomSpecField } from '../common/bom-display';

// 目录解析与规格摘要在共享层（common/bom-display），出库打印文档同样依赖；
// 此处 re-export 保持 boms 模块内引用稳定
export { fixedSpecsOf, parseCategoryFields, specSummaryOf } from '../common/bom-display';

/**
 * BOM 品类规则（db-scheme.md §5）：品类目录（bom_category.spec_schema）是
 * 有效品类、固定规格与编码规则的唯一权威；校验错误消息与前端 mock 逐字对齐。
 */

/** 新微动支架/静片的安装规格（值前缀 6.3/4.8 互斥，两件必须同规格） */
const gaugeOf = (value: string | undefined): '6.3' | '4.8' | undefined => {
    const gauge = value?.trim().match(/^(6\.3|4\.8)/)?.[1];
    return gauge === '6.3' || gauge === '4.8' ? gauge : undefined;
};

/**
 * 规格校验与规范化（创建事务内调用）：
 * 键 NFKC + trim 后必须命中目录键，存储键以目录键为准；值仅 trim、保留
 * 原样字符（存量档案与目录选项均含全角括号等全角字符，NFKC 只用于判重
 * hash，不得改写存储值导致选项校验失配）；固定规格覆盖客户端同名值；
 * 必填与选项按目录校验；新微动支架/静片跨字段规则强制。
 */
export function validateSpecs(
    categoryKey: string,
    fields: BomSpecField[],
    input: Record<string, unknown>,
): Record<string, string> {
    if (input === null || Array.isArray(input) || typeof input !== 'object') {
        throw new BadRequestException('规格必须是对象');
    }
    const fieldByKey = new Map(fields.map(field => [field.key, field]));
    const entries = Object.entries(input);
    if (entries.some(([, value]) => typeof value !== 'string')) {
        throw new BadRequestException('规格值必须是字符串');
    }
    const specs: Record<string, string> = {};
    for (const [key, value] of entries as Array<[string, string]>) {
        const field = fieldByKey.get(key.normalize('NFKC').trim());
        if (!field) {
            throw new BadRequestException('规格中包含当前品类未定义的字段');
        }
        specs[field.key] = value.trim();
    }
    // 固定规格以后端目录为准（客户端同名值不能覆盖）
    Object.assign(specs, fixedSpecsOf(fields));
    for (const key of Object.keys(specs)) {
        if (specs[key] === '') {
            delete specs[key];
        }
    }
    for (const field of fields) {
        const value = specs[field.key];
        if (field.required && !value) {
            throw new BadRequestException(`请填写规格：${field.label}`);
        }
        if (value && field.options && !field.options.includes(value)) {
            throw new BadRequestException(`规格值无效：${field.label}`);
        }
    }
    if (Object.keys(specs).length === 0) {
        throw new BadRequestException('请至少填写一项规格');
    }
    if (categoryKey === 'new-micro-switch') {
        const bracket = gaugeOf(specs['支架']);
        const plate = gaugeOf(specs['静片']);
        if (!bracket || bracket !== plate) {
            throw new BadRequestException('新微动的支架与静片必须使用相同的 6.3/4.8 规格');
        }
    }
    return specs;
}
