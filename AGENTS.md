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
pnpm dev:frontend             # 前端
pnpm dev:backend              # 后端
pnpm typecheck                # 全量类型检查（前端+后端）
pnpm lint                     # 全量 oxlint（type-aware）
pnpm lint --fix               # 自动修复（包装器会跑两遍，收敛重叠修复）
pnpm test                     # test（递归各包）
pnpm test:db:reset            # 重置 e2e 测试库（DROP/CREATE + 迁移 + seed，仅 *_test 库）
pnpm test:e2e                 # 重置测试库 + 后端 e2e
pnpm smoke                    # 后端冒烟（前置：build backend + 测试库已 reset）
pnpm backup-database          # 备份生产库并校验（dump 拉回本地 + 还原比对对象/行数）
pnpm restore-database         # [cli紧急恢复](./docs/db-scheme.md#10-应用内数据库备份恢复仅超管)
pnpm restore-drill            # 恢复演练（双轨 + 故障注入，仅 *_test 库）
pnpm deploy:prod              # 部署生产（--stage-only 可选；不含备份，需留底先跑 pnpm backup-database）
pnpm clean                    # 深度清理：递归删除 node_modules/dist/.turbo/dist.zip；lockfile 删除需传递 --del-lock
```

## 备份/恢复注意（应用内功能，仅超管）

- 恢复 CLI `pnpm restore-database` 的停写前提必须人工保证：先停 backend 与其他写入进程、暂停部署/迁移，再执行；`--yes` 只跳过确认，不绕过停写前提。灾后空库先跑同版本迁移，再 CLI replace；若更换过 JWT_SECRET，须 `docker compose up -d --no-deps --force-recreate backend` 重建容器（不能只 start/restart 旧容器）。
- 忘记超管密码走救援改密：`pnpm restore-database --reset-password <account>`（停写后取得恢复锁，新密码经 stdin 隐藏传入）。

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
- 新增菜单、动作或修改授权范围时，同步核对 `docs/business/roles.md` 的默认授权与权限矩阵说明、`docs/db-scheme.md` §3.3、`docs/openapi.yaml` 的接口权限，并以迁移播种和前后端校验为依据；受保护的系统日志、备份、恢复入口也在范围内。
