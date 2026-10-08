# 业务关系图与 agent 数据接口

分析页的「业务关系图」位于交付进度上方。前端仅负责布局和交互，日期、订单状态、实体类型、关联数据与统计均由后端 `GET /api/workbench/relations` 提供。页面默认近 30 天、进行中订单和全部实体类型。

## 请求

使用现有 Bearer JWT。同时要求 `menu:analytics`、`menu:workbench`，超级管理员直通；沿用现有角色授权，不新增权限或数据库迁移。接口只读，可由前端或 agent 调用；不包含账号密码、联系方式、登录记录或用户管理数据。

| 参数            | 含义                                                                                |
| --------------- | ----------------------------------------------------------------------------------- |
| `start` / `end` | `YYYY-MM-DD`，包含首尾，支持单边；均省略时不限日期                                  |
| `status`        | `open`（默认）、`completed`、`archived`、`all`                                      |
| `types`         | 逗号分隔 `bom,customer,order,inbound,outbound,person`；省略为全部，空串为不显示节点 |
| `orderNo`       | 精确订单号                                                                          |
| `bomCode`       | 精确 BOM 编号                                                                       |
| `customerCode`  | 精确客户编号                                                                        |

例如获取已完成订单的 BOM、客户和销售订单关系：

```http
GET /api/workbench/relations?start=2026-10-01&end=2026-10-08&status=completed&types=bom,customer,order
Authorization: Bearer <accessToken>
```

例如核查某订单的出库及人员、客户、BOM 关联：

```http
GET /api/workbench/relations?status=all&orderNo=<订单号>
Authorization: Bearer <accessToken>
```

例如核查某个 BOM 在指定期间的入库、出库及所引用订单：

```http
GET /api/workbench/relations?status=all&bomCode=<BOM编号>&start=2026-10-01&end=2026-10-08
Authorization: Bearer <accessToken>
```

## 返回与计算口径

沿用 `{ code: 0, data: {...}, message: "ok" }` JSON 信封。`data` 包括：

- `schemaVersion`、`asOf`（当前北京业务日）、`generatedAt`、实际生效的 `filters`。
- `nodes`：稳定 `id`（类型前缀 + 数据库 ID 字符串）、实体 `type`、名称、中文 `properties`、机器可计算的 `facts`；作废节点带 `voided: true`。
- `edges`：`source`、`target`、关系名称及 `kind`。前端直接渲染；类型过滤后只保留两端都存在的边。
- `counts`：日期/编号条件下各状态的订单数，类型筛选不改变它。
- `typeCounts`：状态筛选后、类型筛选前的各实体数量，用于图例。
- `summary`：所选订单数、当前逾期订单 ID、按单位分组的订单量、累计有效出库和待交量；统计不随类型隐藏而变化。

日期按业务事件筛选：订单使用下单日，出入库使用业务日。期间内出库引用的旧订单保留，便于追溯；关联 BOM、客户与人员作为必要上下文保留。`status=all` 还包括期间内只有入库、尚无订单的 BOM；精确查询订单/客户时不夹带这些无关 BOM。

`completed` 按 **累计有效出库量 >= 订单数量** 判断，可能与 `archived` 重叠。`open` 是未归档且尚未交满。归档不代表交满：`unshippedQty` 保留历史未发量，`pendingQty` 为 0，不参与待交和逾期汇总。BOM 和客户没有“已完成”状态；该筛选表示它们与已完成销售订单之间的真实关系。

每次聚合在同一个 Repeatable Read 只读事务快照内取得单据、有效出库净额和当前库存，避免对账时把并发写入前后的数据混用。`order.facts.shipped` 来自 `v_order_outbound_qty`，`bom.facts.stock` 来自 `v_bom_stock`，均为**当前全生命周期净额**，不因日期筛选截断。区间内列出的流水不能直接求和当作累计已发或期末库存；库存还包括库存调整。

已作废但未删除的入库、出库保留追溯，`facts.qty` 是登记数量；核算有效数量时排除 `facts.voided=true`。软删订单、软删单据不返回。入库只关联 BOM，不伪造订单对应关系；出库关联实际订单。人员、客户与 BOM 使用数据库实体 ID，即使同名也不合并。

`facts` 的关联 ID 指向图节点 ID，类型过滤后这些引用可能未出现在 `nodes`；核查完整链路时请求全部实体类型。完整字段定义见 [OpenAPI](../openapi.yaml) 的 `RelationsData`、`Relation*Facts`。
