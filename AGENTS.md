# AGENTS.md

## 包管理器

- 包管理器默认用 pnpm，不用 npm。
- 执行工具默认用 pnpm dlx（对应 npx 的场景），不用 npx。

## 项目架构

```
zmsys/
├── apps/
│   ├── frontend/             # admin-manage 管理后台（React 19 + Vite 8），/api 代理到 backend:5000
│   └── backend/              # zmsys-backend API（NestJS 12 + Fastify + Prisma 7），本地 .env 不入库
├── internal/                 # 配置包
├── packages/                 # 内部包，exports 直指 src 源码
│   ├── request/              # axios 请求客户端（拦截器 / 上传下载 / SSE）
│   └── utils/                # 通用工具函数
├── scripts/                  # gate
```

## 命令

```bash
pnpm dev                      # 并行启动 frontend + backend
pnpm dev:frontend             # 仅前端（Vite，默认 5173）
pnpm dev:backend              # 仅后端（nest start --watch，默认 5000）
pnpm typecheck                # 类型检查
pnpm lint                     # 全量 oxlint（type-aware）
pnpm lint --fix               # 自动修复（包装器会跑两遍，收敛重叠修复）
pnpm test                     # test（递归各包）
```
