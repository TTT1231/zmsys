import { SetMetadata } from "@nestjs/common";
import { SUPER_ONLY_KEY } from "../../constants";

export interface SuperOnlyMetadata {
    message: string;
}

/** 声明端点仅限超级管理员角色本身（按 isSuper 直判，永不校验权限码：
 *  任何权限码都可能被解锁后授予其他角色，用它给受保护开关守门等于自我提权通道）。
 *  与 @Permissions 互斥声明（guard-coverage 四选一） */
export const SuperOnly = (message = "仅超级管理员可操作") =>
    SetMetadata(SUPER_ONLY_KEY, { message } satisfies SuperOnlyMetadata);
