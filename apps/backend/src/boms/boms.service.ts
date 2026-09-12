import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionRunner } from '../prisma/transaction.runner';
import type { Tx } from '../prisma/transaction.runner';
import { SnowflakeGenerator } from '../common/snowflake';
import { normalizeModelCode, specHash } from '../common/bom-spec';
import { beijingDayKey } from '../common/beijing-day';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { BusinessSequenceService } from '../sequence/business-sequence.service';
import type { BomCategory, Bom } from './types';
import { parseCategoryFields, specSummaryOf, validateSpecs } from './bom-rules';
import type { CreateBomDto } from './dto/create-bom.dto';
import type { AuthUser } from '../common/types/auth-user';
import type { BomCategory as BomCategoryRow, BomTable } from '../generated/prisma/client';

/** api_idempotency 的 operation_key，与前端 mock 同粒度 */
const CREATE_OPERATION_KEY = 'boms:create';

/** 品类行 + 规格字段解析结果（fields 元数据随行携带） */
interface CategoryWithFields {
    row: BomCategoryRow;
    fields: ReturnType<typeof parseCategoryFields>;
}

@Injectable()
export class BomsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly snowflake: SnowflakeGenerator,
        private readonly txRunner: TransactionRunner,
        private readonly idempotency: IdempotencyService,
        private readonly sequence: BusinessSequenceService,
    ) {}

    /** 品类目录（契约 bom:view）：仅启用品类，目录修改只走数据库迁移 */
    async listCategories(): Promise<BomCategory[]> {
        const rows = await this.prisma.bomCategory.findMany({ where: { status: true }, orderBy: { id: 'asc' } });
        return rows.map(row => this.toCategory(row));
    }

    /**
     * BOM 档案列表（契约 bom:view）：全量返回（契约无分页），新建置顶
     * （createdAt desc 与 mock unshift 体验一致）。
     */
    async listBoms(): Promise<Bom[]> {
        const categories = await this.prisma.bomCategory.findMany();
        const fieldsOf = new Map(categories.map(row => [row.id, parseCategoryFields(row.specSchema)]));
        const rows = await this.prisma.bomTable.findMany({
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            include: { category: { select: { id: true, name: true } } },
        });
        return rows.map(row => this.toBom(row, row.category.name, fieldsOf.get(row.category.id) ?? []));
    }

    /**
     * 新建唯一 BOM（契约 bom:create，幂等）：锁品类行（db-scheme.md §2 锁序表——
     * BOM 新建锁品类与其序列表，串行化同品类建档）；规格校验按品类目录，
     * 规范化后 (category, model, spec_hash) 命中即 409 并返回已有 bomCode。
     */
    async createBom(dto: CreateBomDto, actor: AuthUser, idempotencyKey: string | undefined): Promise<Bom> {
        const key = this.idempotency.requireKey(idempotencyKey);
        const requestHash = this.idempotency.digest({ method: 'POST', body: dto });

        return this.txRunner.run(async (tx: Tx) => {
            const { replay, placeholderId } = await this.idempotency.beginOrReplay(tx, {
                actorId: BigInt(actor.id),
                operationKey: CREATE_OPERATION_KEY,
                key,
                requestHash,
            });
            if (replay) {
                return replay.body as unknown as Bom;
            }
            if (placeholderId === null) {
                throw new Error('幂等占位缺失');
            }

            const category = await this.lockCategoryByName(tx, dto.name);
            const modelCode = normalizeModelCode(dto.modelCode);
            // DTO 的 MaxLength(64) 量在 NFKC 之前；兼容分解会膨胀长度（ﬁ→fi），
            // 规范化后复检避免连字长串落到数据库 CHECK 约束（500）
            if (modelCode.length > 64) {
                throw new BadRequestException('型号最多 64 个字符');
            }
            const specs = validateSpecs(category.row.categoryKey, category.fields, dto.specs);
            const hash = specHash(specs);

            const duplicate = await tx.bomTable.findFirst({
                where: { categoryId: category.row.id, modelCode, specHash: hash },
                select: { bomCode: true },
            });
            if (duplicate) {
                throw new ConflictException(`BOM 已存在：${duplicate.bomCode}`);
            }

            const now = new Date();
            const bomCode = await this.sequence.nextBomCode(tx, {
                categoryKey: category.row.categoryKey,
                codePrefix: category.row.codePrefix,
                seqWidth: category.row.seqWidth,
            });
            const created = await tx.bomTable.create({
                data: {
                    id: this.snowflake.next(),
                    bomCode,
                    categoryId: category.row.id,
                    modelCode,
                    spec: specs as Prisma.InputJsonValue,
                    specHash: hash,
                    unit: '个',
                    requestKey: this.idempotency.requestKey(BigInt(actor.id), CREATE_OPERATION_KEY, key),
                    createdBy: BigInt(actor.id),
                    updatedBy: BigInt(actor.id),
                    createdAt: now,
                },
            });

            const bom = this.toBom(created, category.row.name, category.fields);
            await this.idempotency.complete(tx, {
                id: placeholderId,
                httpStatus: 200,
                responseBody: bom as unknown as Prisma.InputJsonValue,
                resource: { type: 'bom', code: bomCode },
            });
            return bom;
        });
    }

    /** 定位启用品类并锁定其行：同品类建档串行化，判重与取号在锁内无并发窗口 */
    private async lockCategoryByName(tx: Tx, name: string): Promise<CategoryWithFields> {
        const located = await tx.bomCategory.findUnique({ where: { name } });
        if (!located || !located.status) {
            throw new NotFoundException('品类不存在');
        }
        await tx.$queryRaw`SELECT id FROM bom_category WHERE id = ${located.id} FOR UPDATE`;
        return { row: located, fields: parseCategoryFields(located.specSchema) };
    }

    /** 契约 BomCategory 映射：seqWidth 为 3 时省略（与 mock 目录形态一致） */
    private toCategory(row: BomCategoryRow): BomCategory {
        return {
            key: row.categoryKey,
            name: row.name,
            codePrefix: row.codePrefix,
            ...(row.seqWidth !== 3 ? { seqWidth: row.seqWidth } : {}),
            fields: parseCategoryFields(row.specSchema),
        };
    }

    /** 契约 Bom 映射：created 为北京日；spec 摘要按品类常量过滤 */
    private toBom(row: BomTable, categoryName: string, fields: ReturnType<typeof parseCategoryFields>): Bom {
        const specs = (row.spec ?? {}) as Record<string, string>;
        return {
            code: row.bomCode,
            name: categoryName,
            modelCode: row.modelCode,
            specs,
            spec: specSummaryOf(row.modelCode, specs, fields),
            created: beijingDayKey(row.createdAt),
            unit: row.unit,
        };
    }
}
