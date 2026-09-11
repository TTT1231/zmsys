import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Tx } from '../prisma/transaction.runner';

/**
 * 契约编码格式（db-scheme.md §1.3）：“至少 N 位”表示序号超过显示宽度后
 * 继续增长，不截断、不回绕。
 */
export type SequenceType = 'order' | 'inbound' | 'outbound' | 'adjust' | 'customer';

interface SequenceFormat {
    /** 单号前缀 */
    prefix: string;
    /** 日期段格式；null 表示全局计数 */
    datePattern: 'yyMMdd' | 'yyyyMMdd' | null;
    /** 序号显示宽度下限 */
    minWidth: number;
}

const FORMATS: Record<SequenceType, SequenceFormat> = {
    order: { prefix: 'ZM', datePattern: 'yyMMdd', minWidth: 3 },
    inbound: { prefix: 'RK-', datePattern: 'yyyyMMdd', minWidth: 4 },
    outbound: { prefix: 'CK-', datePattern: 'yyyyMMdd', minWidth: 4 },
    adjust: { prefix: 'TZ-', datePattern: 'yyyyMMdd', minWidth: 4 },
    customer: { prefix: 'CUS-', datePattern: null, minWidth: 4 },
};

/** 业务日期（yyyy-MM-dd）→ 日期段字符串 */
const datePartOf = (pattern: 'yyMMdd' | 'yyyyMMdd', businessDate: string): string => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate);
    if (!match) {
        throw new Error(`业务日期格式须为 yyyy-MM-dd，当前为 ${businessDate}`);
    }
    const [, year, month, day] = match;
    return pattern === 'yyMMdd' ? `${year.slice(2)}${month}${day}` : `${year}${month}${day}`;
};

/**
 * 业务取号（db-scheme.md §1.3）：统一走 biz_sequence 行——事务内
 * INSERT IGNORE 初始化 + SELECT ... FOR UPDATE 行锁 + 递增取号。
 * 禁止“查询最大编码 + 1”；最终编码仍有唯一索引兜底。
 * BOM 按品类取号依赖品类表结构，随 BOM 业务模块接入，此处不预写。
 */
@Injectable()
export class BusinessSequenceService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * 取下一个业务编码。businessDate 为业务日期（yyyy-MM-dd），
     * 订单/入库/出库/调整按该日期各自计数，客户编码全局计数（businessDate 忽略）。
     * 必须在调用方的事务内执行，取号行锁与业务写入同事务提交或回滚。
     */
    async nextCode(tx: Tx, type: SequenceType, businessDate: string): Promise<string> {
        const format = FORMATS[type];
        const datePart = format.datePattern ? datePartOf(format.datePattern, businessDate) : null;
        const sequenceKey = `${type}:${datePart ?? 'global'}`;
        const seq = await this.nextRaw(tx, sequenceKey);
        return `${format.prefix}${datePart ?? ''}${seq.toString().padStart(format.minWidth, '0')}`;
    }

    /**
     * 通用取号：返回原始序号（从 1 起）。序列行不存在时以 1 初始化。
     * 先无锁探测（多数请求已存在，避免并发首插的 INSERT 争用死锁），
     * miss 才 INSERT IGNORE；FOR UPDATE 行锁保证同一 sequence_key 下序号连续且不重复。
     */
    async nextRaw(tx: Tx, sequenceKey: string): Promise<bigint> {
        let rows = await tx.$queryRaw<Array<{ next_value: bigint }>>`
            SELECT next_value FROM biz_sequence WHERE sequence_key = ${sequenceKey}
        `;
        if (rows.length === 0) {
            await tx.$executeRaw`INSERT IGNORE INTO biz_sequence (sequence_key, next_value) VALUES (${sequenceKey}, 1)`;
        }
        rows = await tx.$queryRaw<Array<{ next_value: bigint }>>`
            SELECT next_value FROM biz_sequence WHERE sequence_key = ${sequenceKey} FOR UPDATE
        `;
        const current = rows[0]?.next_value;
        if (current === undefined) {
            throw new Error(`取号失败：序列 ${sequenceKey} 初始化后仍不可见`);
        }
        await tx.$executeRaw`UPDATE biz_sequence SET next_value = ${current + 1n} WHERE sequence_key = ${sequenceKey}`;
        return current;
    }
}
