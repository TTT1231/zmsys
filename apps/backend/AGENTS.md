# AGENTS.md

## 技术选型

NestJS 后端（Fastify 适配器）+ Prisma 7 (MySQL/MariaDB)，CommonJS 构建，pnpm 管理依赖。

## 项目结构

```
├── prisma/                      # schema.prisma、手写迁移 SQL、seed.ts（内置超管与测试账号）
├── scripts/                     # reset-test-db.ts（测试库重置）、smoke.ts（真实进程冒烟）
├── src/
│   ├── configuration/           # env 配置加载与启动校验，AppConfig 类型是配置唯一来源
│   ├── process-tz.ts            # 进程时区统一 UTC（mariadb driver 按 Node 本地时区解释 DATETIME）
│   ├── constants/               # 横切常量：RoleCode 角色码、PERMISSIONS 权限码表、guard 元数据键
│   ├── common/                  # 横切层（只依赖 constants，禁止反向依赖业务模块）
│   │   ├── decorators/          #   @Public / @AuthenticatedOnly / @Permissions / @CurrentUser
│   │   ├── guards/              #   JwtAuthGuard / PermissionsGuard（默认拒绝）/ LoginThrottleGuard
│   │   ├── interceptors/        #   统一响应信封 {code: 0, data, message: 'ok'}
│   │   ├── filters/             #   统一错误信封 + Prisma/MySQL 错误映射（409/404/503）
│   │   ├── errors/              #   TransactionRetryExhaustedError 及可重试标记
│   │   ├── dto/                 #   PageQueryDto 等通用 DTO
│   │   ├── types/               #   AuthUser 会话用户类型（业务 service 以 actor 参数接收）
│   │   ├── snowflake.ts         #   业务主键生成器（SnowflakeModule 全局 provider，1–9999 保留给迁移种子）
│   │   └── datetime.ts          #   北京时间展示格式化 MM-dd HH:mm
│   ├── prisma/                  # PrismaService（@Global）、create-pool（UTC 连接工厂）、TransactionRunner
│   ├── access-control/          # 角色授权查询共享层 + RoleGrant/WbUser 契约类型（auth 与 roles 共用）
│   ├── idempotency/             # IdempotencyService：幂等占位/重放/清理（db-scheme.md §1.3）
│   ├── sequence/                # BusinessSequenceService：biz_sequence 行锁取号 + 编码格式化
│   ├── health/                  # /health/live 与 /health/ready 探针
│   ├── auth/                    # 认证业务：login/logout/profile/password + JwtStrategy
│   ├── roles/                   # 角色目录、授权查询/整组替换（乐观锁）、授权日志
│   ├── types/                   # env.d.ts 环境变量声明
│   └── generated/prisma/        # Prisma 生成代码，不要手动修改
├── test/                        # e2e 与架构测试（Fastify inject；db-guard 强制 *_test 库）
```

说明：

- Prisma Client 输出到 `src/generated/prisma`，属于生成代码，不要手动修改；`pnpm build`（prebuild）与 `pnpm install`（postinstall）都会自动 `prisma generate`。
- **迁移 SQL 手写**：数据库层约束（CHECK、`ascii_bin` 字符集、外键 RESTRICT）无法用 Prisma 表达，迁移 SQL 与基线 `../admin-manage/docs/db/mysql-8-schema.sql` 逐字保持一致；`schema.prisma` 只做客户端类型映射。改表流程：改 schema → `prisma migrate dev --create-only` → 手写迁移 SQL → 应用。
- **依赖方向**：`constants ← common ← access-control/idempotency/sequence ← auth/roles/业务模块`，单向无环。业务模块之间禁止 import 对方内部文件（`test/module-boundary.spec.ts` 强制），跨模块共用走共享层。
- **时间写入约定**：`created_at` 类字段不用 `@default(now())`（映射到 DB 端 `DEFAULT CURRENT_TIMESTAMP`，取值依赖服务器时区；本机 MySQL 的 system_time_zone 为本地化名时服务器时间函数不可信）。一律应用层 `new Date()` 显式写入，事务内取同一时刻。
- **权限三选一**：每个路由 handler 必须恰好声明 `@Public()` / `@AuthenticatedOnly()` / `@Permissions([...])` 之一（`test/guard-coverage.spec.ts` 强制，运行时默认拒绝）。
- **新业务端点**：controller 标 `@Permissions([PERMISSIONS.XXX], '无权xx')`，POST 必须加 `@HttpCode(HttpStatus.OK)`（契约全 200，Nest 默认 201）；写操作加 `@CurrentUser() actor: AuthUser` 传给 service。
- **幂等写端点**（创建/取消/作废/调整/打印类 POST）：必须接收 `Idempotency-Key` 头，事务内经 `IdempotencyService.beginOrReplay → 业务写入 → complete`，组合方式参照 `test/test-idempotency.controller.ts`；事务一律经 `TransactionRunner.run`（死锁整事务重试），回调内禁止邮件/网络请求等外部副作用。
- 数据库约束与 API 契约的权威文档在 `../admin-manage/docs/`（`db-scheme.md`、`api/openapi.yaml`），实现以文档为准。

## 命令

| 用途       | 命令                                                                        |
| ---------- | --------------------------------------------------------------------------- |
| 构建       | `pnpm build`                                                                |
| 格式化     | `pnpm format`                                                               |
| 启动       | `pnpm start` / `pnpm start:dev`                                             |
| lint 检查  | `pnpm lint`                                                                 |
| 类型检查   | `pnpm typecheck`                                                            |
| 测试       | `pnpm test`                                                                 |
| 测试覆盖率 | `pnpm test:cov`                                                             |
| E2E 测试   | `pnpm test:e2e`（内含测试库重置：迁移 + seed）                              |
| 冒烟       | `pnpm smoke`（需先 `pnpm build`；真实进程 + 优雅停机）                      |
| Prisma     | `pnpm prisma:generate` / `prisma:migrate` / `prisma:deploy` / `prisma:seed` |

其中`测试覆盖率`和`E2E测试`尽量不跑，除非必要（E2E 需要 MySQL 8 测试库；CI 全量执行）。
