# AGENTS.md

## 包管理器

- 包管理器默认用 pnpm，不用 npm。
- 执行工具默认用 pnpm dlx（对应 npx 的场景），不用 npx。

## 项目架构

```
zmsys/
├── docs/
│   ├── business/             # 业务文档
│   ├── db-scheme.md          # 决策数据设计文档
│   ├── mysql-8-schema.sql    # 数据库约束文档
│   ├── openapi.yaml          # api 文档
│   └── ai-rules/             # AI 规则
├── apps/
│   ├── frontend/             # 管理后台
│   └── backend/              # 后端 nestjs API
├── internal/                 # 配置包
├── packages/                 # 内部包，exports 直指 src 源码
│   ├── request/              # axios 请求客户端（拦截器 / 上传下载 / SSE）
│   └── utils/                # 通用工具函数
├── scripts/                  # gate / 备份 / 部署
│   ├── backup-database.ts    # 生产库备份+校验
│   └── deploy/               # docker 部署统一管理（compose/Dockerfile/nginx/deploy.ts）
```

## 环境变量

- 统一放在仓库根 `.env`（不入库），模板见 `.env.example`；backend 与 frontend 共用。
- frontend 只读取 `VITE_` 前缀变量（其余变量不会进客户端包）。
- backend 通过 `envFilePath`/dotenv 优先读仓库根，包内 `.env` 兜底（容器/独立部署）。

## 命令

```bash
pnpm dev                      # 并行启动 frontend + backend
pnpm dev:frontend             # 仅前端（Vite，默认 5173）
pnpm dev:backend              # 仅后端（nest start --watch，默认 5000）
pnpm typecheck                # 类型检查
pnpm lint                     # 全量 oxlint（type-aware）
pnpm lint --fix               # 自动修复（包装器会跑两遍，收敛重叠修复）
pnpm test                     # test（递归各包）
pnpm test:db:reset            # 重置 e2e 测试库（DROP/CREATE + 迁移 + seed，仅 *_test 库）
pnpm test:e2e                 # 重置测试库 + 后端 e2e
pnpm smoke                    # 后端冒烟（前置：build backend + 测试库已 reset）
pnpm backup-database          # 备份生产库并校验（dump 拉回本地 + 还原比对对象/行数）
pnpm deploy:prod              # 部署生产（本地构建→上传→远端装配起栈；--stage-only 可选；不含备份，需留底先跑 pnpm backup-database）
```

## tailwindcss 注意

在编写 tailwindcss 之前需要遵守 [tailwindcss规则](./docs/ai-rules/tailwindcss.md)。

## ssh 注意事项

服务器对 ssh 连接频率有限制（多条命令须合并到单连接内），避免多个 ssh 连接造成卡死、连接不上服务器情况。

## 部署注意

- `pnpm deploy:prod` 不内嵌备份，是否先备份按本次改动内容判断：
    - **涉及数据库变更时必须先备份**：新增/修改了 prisma 迁移（表结构、约束、目录 seed 数据），或本次改动会直接写生产库数据；先跑 `pnpm backup-database` 再部署。
    - **仅改前后端业务代码**（迁移文件无变化、不碰生产数据）时无需备份，直接部署。

## 业务参考

- [业务流程](./docs/business/process.md)
- [角色划分](./docs/business/roles.md)
