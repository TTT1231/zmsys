import { SetMetadata } from "@nestjs/common";
import { IS_PUBLIC_KEY } from "../../constants";

/** 标记公开端点（登录、幂等退出），跳过 JWT 校验 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
