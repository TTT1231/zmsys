# src/data · 领域层

业务规则与字典，不含数据、不发请求。开发期数据本体在根目录 `mocks/data/db.ts`，请求在 `src/api/`。

| 文件              | 职责                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `permissions.ts`  | 权限字典（MENU_CATALOG / ACTION_CATALOG / PermCode）+ 纯工具（can / buildNavSections / diffGrants） |
| `categories.ts`   | 开发期 BOM 品类 mock 种子；真实有效目录由后端 `GET /bom-categories` 返回                            |
| `bomSelection.ts` | 从真实 BOM 快照派生逐级规格选择、固定规格与唯一匹配                                                 |
| `views.ts`        | 派生统计纯函数（快照 → 待发货 / 缺口 / 趋势 / TOP），出库可发量的前端口径                           |
| `queries.ts`      | react-query hooks，页面数据入口，含签名适配                                                         |

链路：`页面 → queries.ts → api/ → http/ → [MSW | 后端]`。当前演示由完整快照在 `views.ts` 派生统计；真实后端分页前须补聚合端点。

注意：

- `views.ts` 被 `pnpm test` 直跑，运行时导入须相对路径 + `.ts` 后缀，改动后跑测试。
- 改权限字典同步：`permissions.ts` ↔ `mocks/data/db.ts`（种子）↔ `docs/api/openapi.yaml`。
- 新建 BOM 只接受后端品类目录定义的规格键和值；必填、选项、固定规格、跨字段规则和规范化去重全部由后端复核。
- 销售订单的 BOM 选项从存量 `specs` 动态派生，新增规格字段无需同步维护另一份下拉配置。
