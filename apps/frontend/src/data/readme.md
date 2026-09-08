# src/data · 领域层

业务规则与字典，不含数据、不发请求。数据本体在 `src/mocks/data/db.ts`，请求在 `src/api/`。

| 文件             | 职责                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `permissions.ts` | 权限字典（MENU_CATALOG / ACTION_CATALOG / PermCode）+ 纯工具（can / buildNavSections / diffGrants） |
| `categories.ts`  | BOM 品类模板（规格字段、编码前缀、nextBomCode），契约的一部分，不落库                               |
| `views.ts`       | 派生统计纯函数（快照 → 待发货 / 缺口 / 趋势 / TOP），出库可发量的前端口径                           |
| `queries.ts`     | react-query hooks，页面数据入口，含签名适配                                                         |

链路：`页面 → queries.ts → api/ → http/ → [MSW | 后端]`；统计前端算，口径以 `views.ts` 为准。

注意：

- `views.ts` 被 `pnpm test` 直跑，运行时导入须相对路径 + `.ts` 后缀，改动后跑测试。
- 改权限字典同步：`permissions.ts` ↔ `mocks/data/db.ts`（种子）↔ `docs/api/openapi.yaml`。
- 改品类模板只影响新建 BOM，不回填存量。
