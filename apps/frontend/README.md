# 智造管理系统（admin-manage）

基于 `C:\Users\Tu1231\Desktop\sys` 原型还原的制造业 SaaS 管理系统前端。

## 技术栈

- React 19 + TypeScript + Vite
- TailwindCSS v4（设计令牌对齐原型 `manufacturing-saas-theme.css`：主色 #4f46e5、深色侧栏 #101828、canvas #f5f7fb、圆角 14/18px）
- React Router（`/login` 登录 + `/workbench`、`/orders`、`/customers`、`/bom`、`/inbound`、`/outbound`、`/permissions`、`/search`，AppLayout 统一做认证与菜单守卫）
- TanStack Query（数据快照查询 + 变更失效）
- ECharts 6（按需加载下单与出库趋势，支持 7 / 14 / 30 天）

## 数据层

四层结构：`mocks/`（MSW 假后端：内存数据库 `db.ts` 提供种子数据与业务规则，日期锚点动态取今天，保持不变量：每 BOM Σ入库 − Σ出库 = 库存）→ `src/api/`（契约层，axios 请求，端点对齐 `docs/api/openapi.yaml`）→ `src/http/`（请求基础设施：token 注入、401 跳登录、错误归一）→ `src/data/queries.ts`（react-query hooks，页面数据入口）。开发模式默认启用 MSW，设 `VITE_ENABLE_MSW=false` 联调真实后端。

## 运行

```bash
pnpm dev        # 开发服务器
pnpm build      # 类型检查 + 构建
pnpm lint       # oxlint
pnpm test       # vitest 单元 + 组件测试（数据层纯函数 / UI 交互 / mock 库存规则）
```

## 手机优先的操作方式

小于 1024px 时，订单、客户、BOM、出入库和权限页面使用业务卡片；桌面保留表格。底部导航固定五项，同一角色跨页面保持一致。`/search` 搜索全部订单、客户及成品，结果可直接查看详情或登记发货。

工作台优先展示待处理事项，可按需关注、可发货、缺货产品切换。从任务卡片发货、从缺货产品入库均会带入业务对象；提交后刷新原列表，保留筛选和位置。可发数量按交期分配共享库存，表单与写入校验使用相同口径。

当前由 MSW 提供内存模拟数据（演示账号见 `mocks/data/db.ts`，密码均 `123456`），刷新会恢复种子数据；已有登录鉴权与角色权限（RBAC），尚无真实服务端持久化。
