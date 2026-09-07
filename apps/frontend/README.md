# 智造管理系统（admin-manage）

基于 `C:\Users\Tu1231\Desktop\sys` 原型还原的制造业 SaaS 管理系统前端。

## 技术栈

- React 19 + TypeScript + Vite
- TailwindCSS v4（设计令牌对齐原型 `manufacturing-saas-theme.css`：主色 #4f46e5、深色侧栏 #101828、canvas #f5f7fb、圆角 14/18px）
- React Router（`/workbench/:role`、`/orders`、`/customers`、`/bom`、`/production`、`/inbound`、`/outbound`、`/permissions`）
- TanStack Query（数据快照查询 + 变更失效）
- ECharts 6（按需加载下单与出库趋势，支持 7 / 14 / 30 天）

## 数据层

`src/data/store.ts` 为原型 `workbench-data.js` 的 TypeScript 移植：确定性种子（mulberry32/20260905，锚定日 2026-09-07），86 条订单、33 条 BOM、10 家客户与出入库台账，保持原不变量（每 BOM Σ入库 − Σ出库 = 库存）。`src/data/api.ts` 模拟异步接口，`src/data/queries.ts` 提供 Query hooks。

## 运行

```bash
pnpm dev        # 开发服务器
pnpm build      # 类型检查 + 构建
pnpm lint       # oxlint
pnpm test       # 库存分配与登记回归测试，需要 Node.js 24+
```

## UI 验证脚本

```bash
# 需先启动 dev(5180) 与原型静态服务器(5181, 指向 Desktop/sys)
node scripts/shot.mjs            # 全量页面截图（app-* 与 proto-* 成对对比）
node scripts/shot-interactions.mjs  # 弹窗 + 移动端视口截图
```

## 手机优先的操作方式

小于 1024px 时，订单、客户、BOM、生产、出入库和权限页面使用业务卡片；桌面保留表格。底部导航固定五项，同一角色跨页面保持一致。`/search` 搜索全部订单、客户及成品，结果可直接查看详情或登记发货。

工作台优先展示待处理事项，可按需关注、可发货、缺货产品切换。从任务卡片发货、从缺货产品入库均会带入业务对象；提交后刷新原列表，保留筛选和位置。可发数量按交期分配共享库存，表单与写入校验使用相同口径。

当前仍是内存模拟数据和角色预览，刷新会恢复种子数据；本次界面改造没有增加服务端持久化或认证授权。
