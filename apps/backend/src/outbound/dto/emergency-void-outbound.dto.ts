import { Transform } from "class-transformer";
import { IsBoolean, IsInt, IsString, MaxLength, Min, MinLength } from "class-validator";

/** openapi EmergencyVoidOutboundInput：仅 super；两项线下确认必须为 true（契约 const: true） */
export class EmergencyVoidOutboundDto {
    @IsInt()
    @Min(1)
    expectedVersion!: number;

    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @MinLength(2, { message: "请填写紧急撤销原因（至少 2 个字）" })
    @MaxLength(500, { message: "紧急撤销原因最长 500 个字符" })
    reason!: string;

    @IsBoolean()
    goodsNotDeparted!: boolean;

    @IsBoolean()
    paperInvalidated!: boolean;
}
