# AI 查询端点目录

所有接口统一带全局前缀 /api。JSON 响应使用 {code, data, message} 信封，code=0 表示成功；雪花 ID 以十进制字符串返回，禁止按普通 JavaScript 数字处理以免精度丢失。本目录列出的端点均使用 Bearer JWT；文档与对话端点登录即可，其余按表中权限码校验。本篇只说明用途、权限、关键口径和 operationId，不复制参数全表——具体参数约束以对话系统授予你的工具定义（schema）为准；不要尝试读取仓库文件。

## A. 全业务数据（复用现有接口）

| 端点 | 用途与关键口径 | 权限码 | operationId |
| --- | --- | --- | --- |
| GET /workbench/overview | 全量读模型：BOM、当前库存、全部订单（含归档）和按日出入库数据。 | menu:workbench | getWorkbenchOverview |
| GET /workbench/relations | 业务关系图聚合；nodes.facts 提供可计算的原始字段。过载上限、状态分桶和事实字段详见 analytics 主题。 | menu:analytics + menu:workbench（两者都要） | getWorkbenchRelations |

## B. 各域明细（复用现有接口，各域 view 权限）

| 端点 | 用途与关键口径 | 权限码 | operationId |
| --- | --- | --- | --- |
| GET /orders | 销售订单列表，含归档订单；完成和欠量需结合有效出库净额理解。 | orders:view | listOrders |
| GET /customers | 客户档案列表；普通列表手机号为掩码，完整手机号另受负责人归属校验。 | customers:view | listCustomers |
| GET /boms | 物料与成品 BOM 档案，构成展示使用建档时冻结的明细。 | bom:view | listBoms |
| GET /bom-stocks | BOM 当前库存聚合，按有效入库 + 调整 − 出库净额；无流水 BOM 不在结果中。 | bom:view | listBomStocks |
| GET /bom-stocks/{code}/ledger | 单个 BOM 的库存变动明细（有效入库与出库事件）；回答「某 BOM 库存为什么变了」用这里。 | bom:view | getBomStockLedger |
| GET /inbound | 入库台账，包含有效和作废行；作废行不计入库存。 | inbound:view | listInbound |
| GET /outbound | 出库单列表，包含已登记和已作废单；有效数量按台账事件净额计算。 | outbound:view | listOutbound |
| GET /stock-adjustments | 不可变的库存调整单列表；调整增加库存或减少库存。 | inbound:view | listStockAdjustments |

## C. 操作历史与审计（复用现有接口）

| 端点 | 用途与关键口径 | 权限码 | operationId |
| --- | --- | --- | --- |
| GET /system-logs | 业务时间线。可按 domain、action、操作人账号、时间范围、关键词筛选，并用复合游标续取（用法见下节）。查「谁改的、什么时候改的、为什么」优先用这里；编辑对应 action=edit。默认仅超级管理员持有此权限。 | system-logs:view | listSystemLogs |

日志域包括客户、订单、BOM、BOM 结构、入库和出库。关键词匹配操作人姓名、目标编号或目标名称；日志返回的原因与快照取决于具体动作及留存规则。

## 复合游标续页（/system-logs 与 /ai/agent/deleted 通用）

- 首次请求只带筛选条件（如 domain/action/keyword/limit）；响应 data.nextCursor 在还有下一批时非空，含 at 与 id 两个字段。
- 续页时把 nextCursor.at 原样作为 beforeAt、nextCursor.id 原样作为 beforeId 一并传回，并保持其余筛选条件与首请求完全一致；两个游标参数必须配套使用。
- nextCursor 为 null 表示已取完全部记录——在此之前不得声称「查全了」或把当前批合计当作总量（作废/删除清单同理）。
- 游标里的雪花 id 是十进制字符串，按字符串原样回传，不要转数字。

## D. AI 专属新增端点

| 端点 | 用途与关键口径 | 权限码 | operationId |
| --- | --- | --- | --- |
| GET /ai/agent/docs | 返回根文档和主题清单，供 agent 按需选取文档。 | 登录即可 | getAiAgentDocs |
| GET /ai/agent/docs/{topicId} | 返回指定主题的 Markdown 正文；topicId 使用清单中的 id。 | 登录即可 | getAiAgentDocTopic |
| GET /ai/agent/voided/inbound | 只查仍保留的作废入库，包含作废人、作废时间和原因。 | inbound:view | listAiVoidedInbound |
| GET /ai/agent/voided/outbound | 只查仍保留的作废出库，包含作废人、作废时间和原因。 | outbound:view | listAiVoidedOutbound |
| GET /ai/agent/deleted | 查 delete_* 操作快照；物理删除后唯一留存的删除查询视图，detail 是删除前的完整快照。2026-10 起删除均为物理删除。 | system-logs:view | listAiDeleted |

作废单若之后被物理删除，就不再出现在作废列表；需要查其最终状态快照时，使用已删除查询并确认权限。

## 对话与用量

POST /ai/chat、POST /ai/chat/stream 和 GET /ai/status 均为登录即可使用；它们提供对话代理、流式对话和服务状态，不是 agent 的业务数据查询工具。

## 数据边界与已知语义

- agent 查询沿用各业务端点权限；可见数据与当前登录用户在系统页面可见范围一致。
- 作废/删除查询的 keyword 仅接受可打印 ASCII（它们匹配的是编号/单号列）；按中文姓名或客户名检索请走 GET /system-logs（其 keyword 与 operator 支持中文）。
- 删除快照受 system-logs:view 控制；没有该权限时，不要尝试绕过限制，也不要根据其他列表推断已删除内容。
- 对话请求失败时记录的 token 数为 0，但实际用量标记为未知或部分未知；不得把它向用户表述为已确认的零消耗。
- 重试对话会再次提交一个新请求，不是对原请求的幂等重放。
- 参数范围、响应字段和校验约束以对话系统授予你的工具定义为准；本目录未覆盖的筛选需求，先说明你需要的维度再确认可行性，不要凭猜测拼参数。

## 调用示例

以下命令中的 API_ORIGIN 和 TOKEN 请替换为实际地址与令牌。

按订单域筛选已删除记录：

- curl -H "Authorization: Bearer $TOKEN" "$API_ORIGIN/api/ai/agent/deleted?domain=order&limit=20"

按编辑动作和订单号关键词查系统日志：

- curl -H "Authorization: Bearer $TOKEN" "$API_ORIGIN/api/system-logs?action=edit&keyword=ZM20261015001"
