# AGENTS.md

## 技术选型

NestJS 后端（Fastify 适配器）+ Prisma 7 (MySQL/MariaDB)，ESM 模块，pnpm 管理依赖。

## 项目结构

```
├── prisma/                      # 数据模型（MySQL）和 迁移文件
├── src/
│   ├── configuration/           # env配置加载
├── test/                        # 测试

```

说明：

- Prisma Client 输出到 `src/generated/prisma`，属于生成代码，不要手动修改。

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
