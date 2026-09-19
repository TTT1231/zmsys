/* HTTP 客户端出口：请求基建来自 @zmsys/request，本目录只做实例组装与错误归一；
 * token 存取在 @/lib/token，业务接口层（@/api）从这里引用 requestClient */
export { requestClient } from "./client";
export { ApiError, isApiError } from "./errors";
