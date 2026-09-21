import { Transform } from "class-transformer";
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    MaxLength,
} from "class-validator";

/** openapi CreateBomInput：品类名匹配后端目录；编号与明细快照由服务端决定 */
export class CreateBomDto {
    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @IsNotEmpty({ message: "请选择品类" })
    name!: string;

    /** id 数字串格式与归属校验在 service（按品类目录逐一核对） */
    @IsArray({ message: "物料清单必须是数组" })
    @ArrayMinSize(1, { message: "请至少选择一项物料" })
    @ArrayMaxSize(200, { message: "单份 BOM 最多选择 200 项物料" })
    @IsString({ each: true, message: "物料编号必须是字符串" })
    materialItemIds!: string[];

    /** 数量分组（qty=1）选中项的数量表：物料 id → 1-99 整数；
     * 数值范围与「非数量分组不得携带数量」在 service 按目录校验 */
    @IsOptional()
    @IsObject({ message: "物料数量表必须是对象" })
    quantities?: Record<string, number>;

    /** 品类子选（category key）：品类标记 childCategories 时必填（如跌倒开关的微动开关类型），
     * 服务端将该子品类的完整物料目录并入本品类的选择范围 */
    @IsOptional()
    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @MaxLength(40, { message: "子品类最多 40 个字符" })
    childCategory?: string;

    /** 建档备注：物料构成之外的工艺差异（如"触点是反的"），参与判重指纹——
     * 同构成不同备注 = 不同 BOM；trim 后空串 = 无备注 */
    @IsOptional()
    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString({ message: "备注必须是字符串" })
    @MaxLength(500, { message: "备注最多 500 个字符" })
    remark?: string;
}
