# AGENTS.md

## 包管理器

- 包管理器默认用 pnpm，不用 npm。
- 执行工具默认用 pnpm dlx（对应 npx 的场景），不用 npx。

## 项目架构

```
zmsys/
├── apps/
│   ├── frontend/             # 管理后台，/api 代理到 backend:5000
│   └── backend/              # 后端 nestjs API
├── internal/                 # 配置包
├── packages/                 # 内部包，exports 直指 src 源码
│   ├── request/              # axios 请求客户端（拦截器 / 上传下载 / SSE）
│   └── utils/                # 通用工具函数
├── scripts/                  # gate
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
```
