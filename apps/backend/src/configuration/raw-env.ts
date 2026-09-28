/**
 * DB_* 环境变量的脚本级共享解析层（变量名与默认值的唯一事实源）。
 *
 * 分层：应用启动的必填校验归本目录的 Nest 契约（index.ts，输出 AppConfig）；
 * tsx 脚本（根 scripts/、prisma seed/CLI、一次性运维脚本、e2e 护栏）没有
 * ConfigService，此前各自手抄解析、靠人肉同步默认值。本模块收编为一份宽松
 * 解析：缺省沿用开发库默认值（localhost/3306/root/空密码/zmdb），缺失不报错
 * ——测试/运维场景依赖默认值可跑；必填语义仍归契约层。
 *
 * 不负责 dotenv 加载：调用方 cwd 形态各异（根脚本绝对路径双源、backend 包内
 * 相对路径、容器内免加载走注入 env），加载路径属各场景自身约定；dotenv 幂等
 * （不覆盖已存在的进程变量），多处加载无冲突。保持零依赖：prisma7.config.ts
 * 由 Prisma CLI 的 loader 加载，不能引入更重的依赖。
 */

/** 脚本级宽松解析结果：与后端契约同源的变量名与默认值 */
export interface RawDbEnv {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
}

/** 空白视同缺失：trim 后为空串则落默认值（与契约 required 的 trim 判空口径一致） */
const optional = (raw: string | undefined, fallback: string): string => raw?.trim() || fallback;

/** 按需读取（函数而非模块级常量）：db-guard 等场景会先改写 process.env.DB_DATABASE 再取值 */
export const loadDbEnv = (): RawDbEnv => ({
    host: optional(process.env.DB_HOST, "localhost"),
    port: Number.parseInt(optional(process.env.DB_PORT, "3306"), 10) || 3306,
    user: optional(process.env.DB_USERNAME, "root"),
    password: process.env.DB_PASSWORD ?? "",
    database: optional(process.env.DB_DATABASE, "zmdb"),
});

/** 测试库名派生：开发库名加 _test 后缀；已带后缀则尊重显式配置（reset/smoke/drill/e2e 共用） */
export const deriveTestDatabase = (database: string): string =>
    database.endsWith("_test") ? database : `${database}_test`;
