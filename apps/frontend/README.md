# 智造管理系统（admin-manage）

基于 `C:\Users\Tu1231\Desktop\sys` 原型还原的制造业 SaaS 管理系统前端。

## 技术栈

- React 19 + TypeScript + Vite
- TailwindCSS v4（设计令牌对齐原型 `manufacturing-saas-theme.css`：主色 #4f46e5、深色侧栏 #101828、canvas #f5f7fb、圆角 14/18px）
- React Router（`/workbench/:role`、`/orders`、`/customers`、`/bom`、`/production`、`/inbound`、`/outbound`、`/permissions`）
- TanStack Query（数据快照查询 + 变更失效）
- ECharts 6（工作台 `pendingVsStock` 横向双条形图与 `dailyTrend` 柱线图，配置移植自 `workbench.js`）

## 数据层

`src/data/store.ts` 为原型 `workbench-data.js` 的 TypeScript 移植：确定性种子（mulberry32/20260905，锚定日 2026-09-07），86 条订单、33 条 BOM、10 家客户与出入库台账，保持原不变量（每 BOM Σ入库 − Σ出库 = 库存）。`src/data/api.ts` 模拟异步接口，`src/data/queries.ts` 提供 Query hooks。

## 运行

```bash
pnpm dev        # 开发服务器
pnpm build      # 类型检查 + 构建
pnpm lint       # oxlint
```

## UI 验证脚本

```bash
# 需先启动 dev(5180) 与原型静态服务器(5181, 指向 Desktop/sys)
node scripts/shot.mjs            # 全量页面截图（app-* 与 proto-* 成对对比）
node scripts/shot-interactions.mjs  # 弹窗 + 移动端视口截图
```
