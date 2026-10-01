# src/data · 领域层

前端领域字典、开发期目录种子、派生函数与查询 hooks。业务数据来自后端 API；请求封装在 `src/api/`。

| 文件                | 职责                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `permissions.ts`    | 权限字典（MENU_CATALOG / ACTION_CATALOG / PermCode）+ 纯工具（can / buildNavSections / diffGrants） |
| `categories.ts`     | 开发期 BOM 物料目录种子；真实目录由后端 `GET /bom-categories` 返回                                  |
| `bomComposition.ts` | 根据接口目录将复合 BOM 的冻结物料分为本体与微动系列，不修改历史内容                                 |
| `bomSummary.ts`     | 列表关键规格摘要的展示优先级，不参与目录校验；完整物料仍可展开核对                                  |
| `views.ts`          | 派生统计纯函数（快照 → 待发货 / 缺口 / 趋势 / TOP），出库可发量的前端口径                           |
| `queries.ts`        | react-query hooks，页面数据入口，含签名适配；`useWbView` 供列表页根部一次取快照+防闪烁刷新标志，子组件经 `context/snap` 的 `useSnap` 共享 |
| `workbench.ts`      | 工作台读模型与纯聚合函数                                                                            |

链路：`页面 → queries.ts → api/ → http/ → 后端`。工作台统计由 `/workbench/overview` 聚合端点供给；列表页统计仍由 `views.ts` 按完整快照派生，后端分页前须补聚合端点。

注意：

- `views.ts` 被 `pnpm test` 直跑，运行时导入须相对路径 + `.ts` 后缀，改动后跑测试。
- 改权限字典时核对后端 [`permission-codes.ts`](../../../backend/src/constants/permission-codes.ts)、Prisma 迁移中的 `sys_permission` 播种、[`docs/business/roles.md`](../../../../docs/business/roles.md) 的默认授权与矩阵说明，以及 [`docs/openapi.yaml`](../../../../docs/openapi.yaml) 的接口权限；系统日志、备份、恢复等受保护入口也要纳入核对。
- 新建 BOM 提交品类、选中物料 id 集合及数量分组选中项的 1-99 数量；归属、启用状态、单选组上限、数量和集合判重由后端复核，明细/型号/摘要在建档时冻结为快照。
- 订单/入库选择 BOM 用品类 + 关键字搜索（`components/bom/BomPicker.tsx`）；旧的逐级规格收敛引擎已随预生成组合模式移除。
