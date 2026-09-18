/**
 * 进程时区统一为 UTC，必须在首个 Date/Intl 使用前导入。
 *
 * 原因：mariadb driver 读取 DATETIME 时用无时区参数的 `new Date(...)` 按进程本地
 * 时区解释字面量（lib/io/packet.js），`timezone` 选项只负责连接时 `SET time_zone`，
 * 不影响读方向转换。约定数据库保存 UTC（db-scheme.md §1.1），本地时区为 +8 时
 * 读出的每个 DATETIME 都会偏差 8 小时——把进程本地时区设为 UTC 后，driver 的
 * 字面量解释、Date 默认格式化、日志时间戳全部与库内语义一致。
 */
process.env.TZ ||= "UTC";
