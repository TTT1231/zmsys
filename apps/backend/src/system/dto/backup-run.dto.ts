import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString } from "class-validator";
import { ALL_GROUP_KEYS } from "../backup.catalog";

/** POST system/backup/run：按业务域勾选备份（闭包联动在后端展开） */
export class BackupRunDto {
    @IsArray()
    @ArrayMinSize(1)
    @IsString({ each: true })
    @IsIn([...ALL_GROUP_KEYS], { each: true })
    groups!: string[];

    /** 输出 .sql.gz（gzip 6） */
    @IsOptional()
    @IsBoolean()
    gzip?: boolean;
}
