# src/data · 领域层

业务规则与字典，不含数据、不发请求。开发期数据本体在根目录 `mocks/data/db.ts`，请求在 `src/api/`。

| 文件                | 职责                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `permissions.ts`    | 权限字典（MENU_CATALOG / ACTION_CATALOG / PermCode）+ 纯工具（can / buildNavSections / diffGrants） |
| `categories.ts`     | 开发期 BOM 物料目录 mock 种子（3 品类分区/分组树）；真实目录由后端 `GET /bom-categories` 返回       |
| `bomComposition.ts` | 根据接口目录将复合 BOM 的冻结物料分为本体与微动系列，不修改历史内容                                 |
| `bomSummary.ts`     | 列表关键规格摘要的展示优先级，不参与目录校验；完整物料仍可展开核对                                  |
| `views.ts`          | 派生统计纯函数（快照 → 待发货 / 缺口 / 趋势 / TOP），出库可发量的前端口径                           |
| `queries.ts`        | react-query hooks，页面数据入口，含签名适配                                                         |

链路：`页面 → queries.ts → api/ → http/ → [MSW | 后端]`。当前演示由完整快照在 `views.ts` 派生统计；真实后端分页前须补聚合端点。

注意：

- `views.ts` 被 `pnpm test` 直跑，运行时导入须相对路径 + `.ts` 后缀，改动后跑测试。
- 改权限字典同步：`permissions.ts` ↔ `mocks/data/db.ts`（种子）↔ `docs/api/openapi.yaml`。
- 新建 BOM 只提交品类 + 选中物料 id 集合（无数量）；归属、启用状态、单选组上限与集合判重全部由后端复核，明细/型号/摘要在建档时冻结为快照。
- 订单/入库选择 BOM 用品类 + 关键字搜索（`components/bom/BomPicker.tsx`）；旧的逐级规格收敛引擎已随预生成组合模式移除。
