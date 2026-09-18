# AGENTS.md

## 项目架构

```
zmsys/
├── apps/                    # 应用层
├── internal/                # 配置包
├── packages/                # 内部包，exports 直指 src 源码
│   ├── request/             # axios 请求客户端（拦截器 / 上传下载 / SSE）
│   └── utils/               # 通用工具函数
├── scripts/                 # gate
```

## 命令

```bash
pnpm typecheck                # 类型检查
pnpm lint                     # 全量 oxlint（type-aware）
pnpm lint --fix               # 自动修复（包装器会跑两遍，收敛重叠修复）
pnpm test                     # test
```
