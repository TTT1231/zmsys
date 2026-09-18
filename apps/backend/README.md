# zmsys-backend

智造管理系统后端：NestJS（Fastify 适配器）+ Prisma 7（`@prisma/adapter-mariadb` 驱动适配，MySQL 8.0.16+）+ JWT 认证 + 权限码 RBAC。CommonJS 构建，pnpm 管理依赖。

数据库约束与 API 契约的权威文档在 `../admin-manage/docs/`（`db-scheme.md`、`db/mysql-8-schema.sql`、`api/openapi.yaml`），实现以文档为准。

## 环境准备

1. Node ≥ 24、pnpm 11（`packageManager` 已固定）。
2. MySQL 8.0.16+（本机或 Docker）。**注意**：本机 MySQL 的 `system_time_zone` 若为本地化名称（如中文"中国标准时间"），MySQL 无法解析会导致 `NOW()`/`UTC_TIMESTAMP()` 相互矛盾——本项目所有时间戳由应用显式写入（见下"时区约定"），不依赖服务器时间函数；仍建议在 `my.ini` 固定 `default-time-zone = '+00:00'`。
3. 复制 `.env.example` 为 `.env`，填写 `DB_*` 与 `JWT_SECRET`（≥32 字符，`openssl rand -hex 32`）。无需 `DATABASE_URL`——Prisma CLI 的连接串由 `prisma7.config.ts` 从 `DB_*` 自动组装。

```bash
pnpm install                 # postinstall 自动生成 Prisma Client
pnpm prisma:deploy           # 应用全部迁移（手写 SQL，与基线逐字一致）
pnpm prisma:seed             # 创建 guojun（超管）/ test（员工），初始密码 123456
pnpm start:dev
```

## 时区约定（重要）

- **数据库一律保存 UTC**：连接池由 `src/prisma/create-pool.ts` 统一创建，驱动 `timezone: 'Z'` + 每条池连接会话 `time_zone='+00:00'`。
- **进程时区统一 UTC**：`src/process-tz.ts` 在入口最先导入。mariadb driver 读取 DATETIME 时按 Node 本地时区解释字面量（`timezone` 选项不影响读方向），本地时区为 +8 时读出即偏差 8 小时——进程设 UTC 后读写全链路一致。
- **created_at 不用 `@default(now())`**：该默认值映射到 MySQL `DEFAULT CURRENT_TIMESTAMP`，取值依赖（可能错乱的）服务器时区。所有时间戳由应用 `new Date()` 显式写入，DDL 默认仅作手工 SQL 兜底。
- API 返回带时区 ISO 8601；页面展示转换为 Asia/Shanghai。

## 常用命令

| 用途                                             | 命令                           |
| ------------------------------------------------ | ------------------------------ |
| 构建（prebuild 自动 prisma generate）            | `pnpm build`                   |
| 启动开发                                         | `pnpm start:dev`               |
| lint / 类型检查                                  | `pnpm lint` / `pnpm typecheck` |
| 单元测试                                         | `pnpm test`                    |
| E2E（重置 `*_test` 库 → 迁移 → seed → 真库用例） | `pnpm test:e2e`                |
| 仅重置测试库                                     | `pnpm test:db:reset`           |
| 冒烟（真实进程 + 优雅停机断言）                  | `pnpm smoke`                   |
| Prisma generate / migrate dev / deploy / seed    | `pnpm prisma:generate` 等      |

E2E 安全护栏：`NODE_ENV=test` 且库名以 `_test` 结尾方允许运行，自动重建仅限 localhost；绝不触碰开发库。

## 数据一致性基础设施

业务模块开发前已就绪（均对应 `db-scheme.md §1.3` 契约）：

- **幂等**（`src/idempotency/`）：创建/取消/作废/调整/打印类 POST 携带 `Idempotency-Key`（8–128 可见 ASCII）；占位与业务写入同事务，重放原响应、异摘要 409。用法参照 `test/test-idempotency.controller.ts`。
- **取号**（`src/sequence/`）：`biz_sequence` 行锁事务取号（禁止 MAX+1），订单/入库/出库/调整/客户五类编码格式化。
- **事务重试**（`src/prisma/transaction.runner.ts`）：死锁/锁超时对**整个事务**指数退避重试（默认总尝试 3 次），耗尽抛 `TransactionRetryExhaustedError` → 503。事务回调必须可重入、禁止外部副作用。
- **错误映射**（`src/common/filters/`）：P2002→409、P2025→404、锁冲突→503；500 记录原始异常与 requestId，不外泄细节。
- **权限默认拒绝**：每个端点必须声明 `@Public()` / `@AuthenticatedOnly()` / `@Permissions([...])` 恰好之一，架构测试强制；漏写即 403。
- **登录限流**：IP+账号 10 次/5 分钟，超限 429。

## 前端联调

契约 servers 为 Vite 代理（同源）；直连场景配置 `CORS_ORIGINS` 白名单。健康探针：`GET /api/health/live`、`GET /api/health/ready`。
