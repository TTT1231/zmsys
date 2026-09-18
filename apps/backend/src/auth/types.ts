/** JWT 载荷：只证明会话身份；角色、启停状态与实时授权每次请求以数据库为准 */
export interface JwtPayload {
    /** 用户 id 字符串（业务 id 不暴露给前端数值形态） */
    sub: string;
    /** 签发时的 token_version，改密/停用/角色变更后递增使旧 token 失效 */
    ver: number;
    iat: number;
    exp: number;
    jti: string;
}
