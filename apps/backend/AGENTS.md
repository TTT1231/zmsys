# AGENTS.md

## 技术选型

NestJS 后端（Fastify 适配器）+ Prisma 7 (MySQL/MariaDB)，ESM 模块，pnpm 管理依赖。

## 项目结构

```
├── prisma/                      # schema.prisma、手写迁移 SQL、seed.ts（内置超管与测试账号）
├── src/
│   ├── configuration/           # env 配置加载，AppConfig 类型是配置唯一来源
│   ├── constants/               # 横切常量：RoleCode 角色码、PERMISSIONS 权限码表、guard 元数据键
│   ├── common/                  # 横切层（只依赖 constants，禁止反向依赖业务模块）
│   │   ├── decorators/          #   @Public / @CurrentUser / @Permissions
│   │   ├── guards/              #   JwtAuthGuard / PermissionsGuard（全局 APP_GUARD，先认证后授权）
│   │   ├── types/               #   AuthUser 会话用户类型（业务 service 以 actor 参数接收）
│   │   ├── interceptors/        #   统一响应信封 {code: 0, data, message: 'ok'}
│   │   ├── filters/             #   统一错误信封 {code: HTTP状态, data: null, message}
│   │   ├── snowflake.ts         #   业务主键生成器（1–9999 保留给迁移种子数据）
│   │   └── datetime.ts          #   北京时间展示格式化 MM-dd HH:mm
│   ├── prisma/                  # PrismaService（@Global，@prisma/adapter-mariadb）
│   ├── auth/                    # 认证业务：login/logout/profile/password + JwtStrategy
│   ├── roles/                   # 角色目录、授权查询/整组替换（乐观锁）、授权日志
│   ├── types/                   # env.d.ts 环境变量声明
│   └── generated/prisma/        # Prisma 生成代码，不要手动修改
├── test/                        # e2e 集成测试（Fastify inject，需本地 MariaDB + 已 seed）
```

说明：

- Prisma Client 输出到 `src/generated/prisma`，属于生成代码，不要手动修改。
- **迁移 SQL 手写**：数据库层约束（CHECK、`ascii_bin` 字符集、外键 RESTRICT）无法用 Prisma 表达，迁移 SQL 与基线 `../admin-manage/docs/db/mysql-8-schema.sql` 逐字保持一致；`schema.prisma` 只做客户端类型映射。改表流程：改 schema → `prisma migrate dev --create-only` → 手写迁移 SQL → 应用。
- **依赖方向**：`constants ← common ← auth/roles/业务模块`，单向无环。跨模块只从 `common/` 与 `constants/` 引公共件，不要 import 其他业务模块的内部文件。
- **新业务端点**：controller 标 `@Permissions([PERMISSIONS.XXX], '无权xx')`，POST 必须加 `@HttpCode(HttpStatus.OK)`（契约全 200，Nest 默认 201）；写操作加 `@CurrentUser() actor: AuthUser` 传给 service。
- 数据库约束与 API 契约的权威文档在 `../admin-manage/docs/`（`db-scheme.md`、`api/openapi.yaml`），实现以文档为准。

## 命令

| 用途       | 命令             |
| ---------- | ---------------- |
| 构建       | `pnpm build`     |
| 格式化     | `pnpm format`    |
| 启动       | `pnpm start`     |
| lint检查   | `pnpm lint`      |
| 类型检查   | `pnpm typecheck` |
| 测试       | `pnpm test`      |
| 测试覆盖率 | `pnpm test:cov`  |
| E2E 测试   | `pnpm test:e2e`  |

其中这个`测试覆盖率`和`E2E测试`尽量不跑，除非必要。
