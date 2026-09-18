import { Type } from "class-transformer";
import { IsInt, Max, Min } from "class-validator";

/** 列表查询通用分页参数；契约暂无分页定义，首个业务列表端点接入时回写 openapi.yaml */
export class PageQueryDto {
    /** 页码从 1 起 */
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page: number = 1;

    /** 每页条数 1–100，默认 20 */
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    pageSize: number = 20;
}

/** 分页结果信封：list + 总数与回显的分页参数 */
export interface PageResult<T> {
    list: T[];
    total: number;
    page: number;
    pageSize: number;
}

/** 组装分页结果 */
export const pageResult = <T>(query: PageQueryDto, total: number, list: T[]): PageResult<T> => ({
    list,
    total,
    page: query.page,
    pageSize: query.pageSize,
});

/** PageQueryDto → Prisma skip/take */
export const toSkipTake = (query: PageQueryDto): { skip: number; take: number } => ({
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
});
