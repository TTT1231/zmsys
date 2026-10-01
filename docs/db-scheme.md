# 数据库表结构与一致性约束

> 目标数据库：MySQL 8.0.16+ / InnoDB。可执行建表基线见 [`docs/mysql-8-schema.sql`](mysql-8-schema.sql)。本文件定义业务语义、数据库约束边界与事务规则；实现不得只参考页面或 mock。

## 0. 已确认的设计决策

1. 业务主键 `id` 使用应用层 Snowflake 生成的 `BIGINT`，只在服务端和数据库内部流转。`1–9999` 保留给迁移脚本中的固定参考数据（当前仅 BOM 品类）；Snowflake 生成器不得使用该区间。API 使用业务编码；若确需返回 id，必须序列化为字符串。
2. 登录使用账号、密码换取 JWT。JWT 只证明会话身份；每次请求仍按 `sub` 查询 `sys_user`，确认账号启用状态、当前角色、`token_version` 和实时授权，不能只信任 token 中的旧角色。
3. 入库采用“当天可直接修正 + 永久审计、跨日只追加库存调整”的规则（作废例外见 7.1：持受保护权限 `inbound:void-any-day` 的超级管理员可跨天作废）；出库数量流水不原地修改，作废通过追加冲销流水处理。订单和出入库台账可软删除，7 天保留期后由维护任务物理清理；BOM 无引用时可直接物理删除。
4. 销售订单没有取消生命周期（2026-09 清理）：一件未发不要了直接删除，发过货不要了归档结案。归档必须记录操作人、时间（备注选填）；归档订单不再参与欠量、合作状态和可发库存分配。净发货为 0 且关联出库单均已删除的订单可由超级管理员软删除；删除事件与订单快照写 `op_log` 留痕。
5. 客户当前负责人必须是启用中的销售或超级管理员。销售或超级管理员停用、或转为其他角色前，如仍负责客户，超级管理员必须在同一事务中批量移交这些客户。
6. 修改密码由用户自行选择，不强制首次登录修改。初始密码仍为 `123456`，数据库只保存强哈希。
7. BOM 品类、编码规则与判重规则以后端为唯一权威来源；相同品类、物料构成与备注不允许重复建档。未被销售订单引用、也无出入库/调整流水的 BOM 可由超级管理员物理删除，用于清理手误建档；删除事件与档案快照写 `op_log` 留痕。
8. 客户、订单、入库、出库单头、用户、角色授权等可变数据使用乐观锁；库存变化、取号、出库分配和批量移交使用数据库事务与行锁。

## 1. 全局物理约定

### 1.1 字符、时间与空值

- 数据库默认 `utf8mb4`；业务编码和账号列使用 ASCII 二进制排序规则，比较区分大小写。账号当前允许 `[A-Za-z0-9_]`，登录时按原值精确匹配。
- `created_at` / `updated_at` / 日志时间使用 UTC `DATETIME(3)`；API 统一返回带时区的 ISO 8601。页面展示时转换为 `Asia/Shanghai`。
- 用户选择的订单、入库、出库业务日期单独存为 `DATE`，不得与服务端实际操作时间混为一个字段。
- 无值统一使用 `NULL`：如客户县区/乡镇、从未登录的 `last_login_at`。备注与付款条件使用非空字符串，默认 `''`。
- 所有数量均为整数。订单、有效入库和普通出库数量必须大于 0；库存调整和出库冲销使用非零的有符号差额。

### 1.2 外键与删除

- 外键一律指向被关联表的主键 `id`，不指向业务编码。
- 所有业务外键使用 `ON DELETE RESTRICT ON UPDATE RESTRICT`。
- 用户停用使用状态字段；订单归档使用生命周期字段。订单与已作废出入库单删除时打 `deleted_at` 标记并立即从列表移除，7 天后由 maintenance 在外键允许时物理清理；删除动作先在 `op_log` 留全量快照。无引用的 BOM 可由超级管理员直接物理删除。授权日志和操作日志不随业务行清理。
- 外键只能保证“目标存在”。“客户负责人必须是启用销售”等跨行、跨表规则由事务内服务校验完成。

### 1.3 业务编码与并发取号

| 类型         | 显示格式                                        | 计数范围                          |
| ------------ | ----------------------------------------------- | --------------------------------- |
| 订单号       | `ZM` + yyMMdd + 至少 3 位序号，如 `ZM260910001` | 按 `order_date` 每日从 001 起     |
| 入库单号     | `RK` + yyMMdd + 至少 2 位序号，如 `RK26091201`  | 按 `business_date` 每日从 01 起   |
| 出库单号     | `CK` + yyMMdd + 至少 2 位序号，如 `CK26091201`  | 按 `business_date` 每日从 01 起   |
| 库存调整单号 | `TZ-` + yyyyMMdd + 至少 4 位序号                | 按 `business_date` 每日从 0001 起 |
| 客户编码     | `CUS-` + 至少 4 位序号                          | 全局从 0001 起                    |
| BOM 编码     | 品类前缀 + 至少 `seq_width` 位序号，如 `XK2001` | 每个品类独立计数                  |

- “至少 N 位”表示序号超过显示宽度后继续增长，不截断、不回绕。
- 禁止使用“查询最大编码 + 1”。统一使用 `biz_sequence` 行：在事务中 `SELECT ... FOR UPDATE` 后递增并取号。
- 最终业务编码仍有唯一索引兜底；唯一冲突或死锁必须做有限次数、带抖动的事务级重试。
- `Idempotency-Key` 长度为 8–128 个 ASCII 字符。后端先以 `(actor_id, operation_key, idempotency_key)` 写入/锁定 `api_idempotency`；相同 key 但请求摘要不同返回 409，相同请求在首次提交后重放原响应，不能再次执行业务事务。
- 业务表的 `request_key` 不存原始 `Idempotency-Key`：幂等唯一域含 `actor_id`，而业务表的 `request_key` 唯一键是全局的，两个用户各自首次使用同一原始 key 会相撞。统一存幂等三元组 `(actor_id, operation_key, idempotency_key)` 以 `\n` 连接后的 SHA-256 十六进制（定长 64，落在 8–128 ASCII 约束内）。
- 幂等占位与业务写入处于同一事务：首请求回滚时占位也回滚，允许安全重试；首请求提交但响应丢失时，重试从 `response_json` 返回原结果。幂等记录至少保留 24 小时，清理只按 `expires_at` 删除过期记录。

### 1.4 约束执行边界

| 层级       | 必须负责的约束                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| 数据库     | 主键、唯一键、外键、非空、字段范围、日期先后、JSON 类型、版本号、幂等键、不可删除权限                                    |
| 单事务服务 | 出库可发量、订单数量不低于累计已发、入库当天修改窗口、库存调整、出库冲销、客户负责人资格与批量移交、取号、授权替换与日志 |
| API 校验   | 字符串 trim、日期解析、手机号/账号格式、字段长度、未知字段拒绝、规格业务规则、权限码校验                                 |
| 前端       | 即时提示和交互引导；不得作为数据正确性的唯一防线                                                                         |

## 2. 全表并发策略

| 操作               | 并发控制                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 客户编辑           | `WHERE id=? AND row_version=?`，成功后版本 `+1`；0 行受影响返回 409                                                         |
| 订单编辑           | 固定先锁 BOM，再锁订单；校验 `row_version` 和累计已发；成功后版本 `+1`                                                      |
| 订单删除           | 仅超级管理员；固定先锁 BOM，再锁订单；校验 `row_version`、累计已发为 0 且无任何出库单引用；同事务删除变更日志并写 `op_log`  |
| 用户编辑/启停      | 锁目标用户；若销售离岗，按 id 顺序锁接任销售及其全部客户，批量移交、记录历史、更新用户必须同事务                            |
| 角色授权           | 锁 `sys_role`；请求携带 `grant_version`；替换授权、写前后快照日志、版本 `+1` 同事务                                         |
| BOM 新建           | 锁品类与其序列表；规范化规格、计算 SHA-256 指纹；唯一键防重复                                                               |
| BOM 删除           | 仅超级管理员；锁 BOM 行；校验无订单引用且无入库/调整流水；同事务删除明细与主行并写 `op_log`                                 |
| 入库新增/当天修改  | 按 id 升序锁修改前后的 BOM，再锁入库行；校验北京时间录入日、版本与修改后的库存，更新入库并写前后快照日志                    |
| 跨日库存调整       | 仅超级管理员；锁 BOM，校验调整后库存非负，追加不可变的调整单                                                                |
| 出库登记/作废      | 锁 BOM、订单、出库单头；聚合校验、单头、数量流水与操作日志同事务，冲销只追加新事件                                          |
| 登录/个人资料/改密 | 个人姓名只做单字段原子更新；改密锁用户并递增 `token_version` 与 `row_version`，旧 JWT 立即失效，客户端清除 token 并重新登录 |

所有需要多行锁的流程都按“BOM → 订单 → 流水”“用户 id 升序 → 客户 id 升序”的固定顺序取锁，降低死锁概率。发生死锁时只能重试整个事务，不能只重试最后一条 SQL。

事务统一以 READ COMMITTED 隔离级别运行：并发控制以行锁（锁定读）为主体。幂等占位查询（普通读）总是先于业务行锁发生，REPEATABLE READ 的事务级快照会让行锁之后的聚合读（如 `v_bom_stock`）仍取旧快照；READ COMMITTED 每条语句取新快照，锁定读之后的普通读能看到最新已提交行。

## 3. 系统与权限表

### 3.1 `sys_role`

固定五个角色：`super/admin/warehouse/sales/staff`。`super` 为内置锁定角色，权限由服务端直接视为全量，不允许通过接口修改。`grant_version` 是整组授权的乐观锁版本。

### 3.2 `sys_user`

| 字段            | 语义与约束                                               |
| --------------- | -------------------------------------------------------- |
| `id`            | Snowflake 主键                                           |
| `account`       | 唯一、不可修改，3–64 位字母/数字/下划线                  |
| `password_hash` | Argon2id/bcrypt 等强哈希，最长 255；绝不保存或返回明文   |
| `name`          | 1–20 个 Unicode 字符                                     |
| `role_code`     | 外键到 `sys_role.code`                                   |
| `status`        | 1 启用、0 停用                                           |
| `token_version` | JWT 失效版本；停用、角色变更、改密、管理员重置密码时递增 |
| `row_version`   | 用户资料与状态的乐观锁版本                               |
| `last_login_at` | 可空，成功登录后更新                                     |
| `created_at`    | 创建时间，UTC `DATETIME(3)`，新建用户时写入              |
| `updated_at`    | 可空，最近一次资料/状态/密码变更时间，变更时刷新         |

规则：

- 新增用户不得选择 `super`；系统初始化时单独创建内置超级管理员。
- `super` 账号不可停用、改角色或由普通重置接口处理。
- 停用账号后，后端下一次鉴权查询立即拒绝旧 JWT。
- 销售改角色或停用时，若仍有客户，必须提供启用中的接任销售；批量移交与用户更新原子完成。
- 姓名等用户资料仅由管理员通过用户管理接口修改；不提供本人自助改名接口，个人中心只读展示资料与创建/修改时间。

### 3.3 `sys_permission` / `sys_grant`

- 权限目录由后端维护并通过 API 下发。数据库只接受 `sys_permission` 中存在的授权码。
- 菜单码格式：`menu:<menuKey>`，如 `menu:orders`。
- 动作码格式：`<menuKey>:<actionId>`，如 `outbound:ship`。
- 勾选动作必须同时拥有其父菜单和对应 `view` 动作；保存时由服务端规范化并复核。
- `(role_code, permission_code)` 为 `sys_grant` 主键。`permissions:view/manage`、客户批量移交、订单删除、订单归档、BOM 删除、`menu:system-logs`、`system-logs:view`、`system-backup:run` 与 `system-restore:run` 属于受保护权限，只允许 `super`。
- `menu:system-backup` / `menu:system-restore` 在目录中为非受保护菜单码，但不播普通角色授权，前端也不提供勾选。备份目录、恢复预检/任务查询与实际执行端点均检查对应受保护的 `:run` 动作，单独持有菜单码不能调用这些接口；系统日志端点检查 `system-logs:view`。默认角色分布及权限矩阵显示口径见 [角色与权限](business/roles.md)。
- 建表脚本直接播种四个普通角色的默认授权。初始行使用 `grant_source=BOOTSTRAP` 且 `granted_by=NULL`；此后所有界面修改必须使用 `grant_source=USER` 和真实操作人。`super` 不依赖授权行，服务端固定视为全量权限。归档订单菜单 `menu:archived-orders` 为普通菜单，四个普通角色默认可见（数据来自既有 `orders:view`，归档动作本身仍仅 `super`）。

### 3.4 `sys_grant_log`

每次授权保存——包括空备注——都要在同一事务中记录。无变化请求直接返回当前授权且不递增版本，并记录为 no-op 安全事件。日志保存服务端生成的说明、变更前后完整快照和前后版本；客户端文字只能作为补充原因，不能作为审计事实来源。

### 3.5 `api_idempotency` / `sys_user_change_log`

- `api_idempotency` 是所有创建、归档、删除、作废与库存调整类 POST 的统一幂等登记表；表内保存请求 SHA-256、处理状态和成功响应快照。
- `sys_user_change_log` 保存新增用户、管理员对用户资料的修改、角色/状态变更与改密事件。快照不得包含密码哈希；密码事件只记录“已变更”及版本，不记录任何密码材料。

## 4. 客户表

### 4.1 `custom_table`

客户编码唯一；联系方式、四级行政区划和详细地址按表结构长度校验。`district` / `town` 可空。完整手机号只存库，普通响应只返回掩码；完整号仅 `GET /customers/{code}/phone` 一个口子，且仅超级管理员或客户当前负责人（销售）可获取，前端只在复制动作时调用，页面展示一律掩码。

`owner_id` 表示**当前负责人**。新建和单个客户编辑时，后端必须锁定并确认负责人为启用中的 `sales` 或 `super`（省市/地址可空，未填写存 `NULL`，见 §1.1）。API 同时返回负责人账号和姓名，禁止前端用姓名反查账号。

合作状态不落库：以 `order_date >= CURRENT_DATE - INTERVAL 6 MONTH` 的活动订单为准，含边界日期；有订单为“合作中”，否则“待跟进”。不是固定 180/183 天。

### 4.2 `customer_owner_history`

每次负责人变化写一行，保存客户、原负责人、新负责人、操作人、原因、批次号和时间。销售离岗的一次批量移交共用同一 `batch_id`，便于审计和回溯。

## 5. BOM/成品档案

BOM = **品类 + 使用者勾选的物料集合（数量分组可携带 1-99 数量）+ 建档备注**。建档人在前端“左框树状目录勾选 / 右框已选确认”后保存，服务端按品类目录校验、判重并生成编号；不做规格组合的预生成。这里的 BOM 仍是订单所引用的“成品档案”，不是生产过程中的原材料用量 BOM；生产与原材料库存在线下。

### 5.1 `bom_category` + 物料目录三张表

品类目录由后端提供（`bom_category`：稳定 key、显示名称、编码前缀、最小序号宽度、可空 `child_categories` JSON 数组），前端只能消费。已用品类前缀：旋转XK2 `XK2`、旋转XK3 `XK3`、新微动 `KW`、老微动 `KWO`、安全开关 `AQ`、跌倒开关 `KD`、琴键开关 `KQ`（编码如 `XK2001` / `KW001` / `KWO001` / `AQ001` / `KD001` / `KQ001`）；另有焊线 `XK3W`（xk3-wire）、插线 `XK3P`（xk3-plug）两个停用品类，仅作为旋转XK3 的接线工艺目录容器（child_categories 引用），不出现在建档品类下拉。`child_categories` 标记变体品类：建档时先从列表中单选一个子品类，物料目录按 5.2 合并校验，不引用任何已建 BOM（跌倒开关 → `["new-micro-switch", "old-micro-switch"]` 选微动开关类型，旋转XK3 → `["xk3-wire", "xk3-plug"]` 选接线工艺）。

可选物料目录由三张表表达，目录修改只走数据库迁移并同步 mock 种子：

- `material_group`：目录树节点。`kind=SECTION` 为分区（纯展示与折叠，只能为根节点、不挂物料、无 key/multi/qty，如“PA66塑料 / 五金件”）；`kind=GROUP` 为分组（挂可选物料），必须有稳定 `group_key`、`multi` 选择语义与 `qty` 数量语义——`multi=0` 单选（0/1 项，换选替换、可取消），`multi=1` 多选（可全选/清空）；`qty=1` 数量分组（选中项可携带 1-99 数量，前端呈 −/×N/+ 步进器，如琴键开关的扣板/连锁片/静片/动片），`qty=0` 恒为 1。分组可直接挂品类或挂同品类分区下；禁止跨品类挂接与超过两级的层级。分区停用后其下所有物料不可用于新建 BOM。`group_key='model'` 的分组选中项即 BOM 型号。
- `material_item`：可选物料项（如“6.3支架：铜镀银”“二脚底座（无挡脚）”），完整物料名逐项可选，不再组合。
- `bom_item`：BOM 明细行，建档时冻结 `group_key/group_name/name/position/quantity` 快照（数量分组 1-99，其余恒 1）。

**目录不可变边界**：已被 `bom_item` 引用的物料不得改名、移组或复用 id；规格变化 = 新增物料项 + 旧项停用；停用只影响新建选择，已建 BOM 依靠快照完整显示。唯一例外是**名称规范化**——同一规格仅修正显示名（如触点大小 0.3 → 3.0mm、卡线片 0.15 → 底盖0.15，见迁移 20260923000000）：原地改名保留 id，且同一迁移内必须同步改写 `bom_item` 冻结名与订单 `bom_spec_snapshot`，保证新旧档案显示一致；`sales_order_change_log` 为历史凭证不回改。订单 `bom_spec_snapshot` 冻结 `{items: [{materialId, groupKey, groupName, name, position, quantity}], modelCode, spec}`（JSON 对象，quantity 于 2026-09 加入，旧快照缺省按 1），出库打印文档的 `bomSpec` 直接取该冻结值，不读当前目录。

### 5.2 `bom_table`

- `category_id` 外键到品类；无型号/规格列——型号与物料明细都在 `bom_item` 快照中。
- `remark` 建档备注（TEXT，默认 `''`）：承载物料构成之外的工艺差异（如「镀锡：动片铜点（白色）触点是反的」），保存时 trim，参与判重指纹；空串 = 无备注。
- 判重：materialItemIds 校验为正十进制 BIGINT 数字串 → `BigInt(id).toString()` 规范化（消除前导零双表示）→ 去重 → 与各自数量组成 `[id, quantity]` 对、按 id 数值升序 → 序列化为 `[[id, quantity], ...]`，再与品类 id、备注组成三元素 JSON 数组（数字不加引号，备注为 trim 后原文）→ SHA-256 `spec_hash`（BINARY(32)）。同一物料集合、不同数量或不同备注 = 不同 BOM。不得无分隔拼接、不得转 Number 排序。备注维度于 2026-09 加入指纹，存量以同构 SQL 重算（迁移 20260927000000）。
- 唯一键 `(category_id, spec_hash)` 禁止重复 BOM；命中时返回 409 及已有 `bom_code`（输入顺序与重复 id 不影响指纹）。
- 建档校验（后端权威）：ids 非空、去重；物料经组归属该品类（品类标记 `child_categories` 时可同时归属所选子品类，目录合并校验）；品类/分区/分组/物料均启用；单选组最多 1 项；数量仅 `qty=1` 分组的选中项允许 1-99 整数（缺省 1），其余分组携带非 1 数量拒绝。所有组皆可不选（客户决定要不要 A 面这类项），但整份 BOM 至少选 1 项。旧规格体系的跨字段规则（新微动支架/静片 6.3/4.8 同口径等）已废除，同类部件互斥由单选分组结构表达。
- 跌倒开关、旋转XK3 等品类通过 `child_categories` 标记合并子品类目录：建档时先选子品类（`childCategory`，如跌倒开关的微动开关类型 new-micro-switch / old-micro-switch、旋转XK3 的接线工艺 xk3-wire / xk3-plug，均二选一），可选物料 = 本品类目录 + 所选子品类完整目录（分区/分组/物料原样并入树），统一走普通物料勾选，不引用任何已建 BOM。
- BOM 建档后不原地修改物料集合；构成变化时新建 BOM。已引用或已有流水的档案保留原状；未被引用的手误档案可删除：
    - 仅超级管理员（受保护权限 `bom:delete`）；前端无权限不显示删除入口，后端仍独立校验。
    - `sales_order_table` 不得有任何引用（含已归档订单——归档单永不物理清理即视为引用），`inbound_ledger` 与 `stock_adjustment` 不得有任何流水；出库流水经订单引用订单被删前提是零出库，故无需单独校验。数据库外键 RESTRICT 是最终防线。
    - 删除事务先锁 BOM 行（订单新建与入库登记同样先锁 BOM，§2 锁序），校验通过后同事务删除该 BOM 全部 `bom_item`（外键 RESTRICT 要求先清理）与 `bom_table` 行，并写 `op_log(action=delete_bom)`，`detail_json` 保存删除前档案快照。
    - 删除与订单新建、入库登记竞争同一 BOM 行锁，先提交者生效，后提交者返回 409。BOM 建档后不可修改，无乐观锁版本。
- 幂等与判重分开：同用户、同操作、同幂等键且请求摘要一致时重放原成功响应；同键不同请求内容返回 409。事务顺序：幂等检查 → 锁品类行 → 目录校验（含子品类合并）→ 集合判重 → 取号（品类前缀 + 至少 `seq_width` 位序号）→ 写 `bom_table` + `bom_item` 快照 → 落幂等响应。

## 6. 销售订单

### 6.1 `sales_order_table`

- 外键关联客户和 BOM；API 新建只接收 `customerCode` / `bomCode`，名称和规格由后端查询。
- `qty > 0`；交货日期 `deliver_date` 为单个日历日。
- `lifecycle_status` 为 `ACTIVE` 或 `ARCHIVED`（两态，2026-09 清理取消生命周期：一件未发不要了直接删除，发过货不要了归档结案）；完成、部分发货、部分可发货、待备货、可发货继续由累计已发和库存派生（可发货口径与"本次最多可发"一致，按交期分配，不占用更早订单预留；分配后可发量盖不住剩余待交即为部分可发货）。
- 未发货订单可修改数量、交货日期与备注，修改数量时新数量必须大于等于该订单有效出库净额；已发货（有效出库净额 > 0）订单数量与交货日期锁定，仅可修改备注；已归档订单不可修改。
- 保存下单时的客户名称及 BOM 名称、型号、规格快照，避免客户改名或品类调整后历史订单、出库单内容漂移。
- 所有编辑和归档写 `sales_order_change_log` 前后快照。
- 归档（受保护权限 `orders:archive`，仅 `super`）：收尾已完成或部分发货的订单，使其退出活跃视图：
    - 归档三要素 `archived_at` / `archived_by` / `archive_reason`（备注选填，`ck_sales_order_archive` 要求 ARCHIVED 态前两者非空）；归档人与时间供审计，操作人姓名经 `archived_by` 关联 `sys_user` 带出。
    - 一件未发的订单不可归档：手误单走删除。存在未作废出库单时归档直接放行，已发数量保留。归档与删除、出库登记、作废竞争同一订单锁（先 BOM 后订单），先提交者生效。
    - 归档为最终终态且不可恢复：不可修改（含备注）、不可删除、禁止新增正向出库；剩余欠量（若有）随之关闭，不再计入待交付、可发量分配与工作台活跃统计，历史需求与客户排名仍全额保留。
    - 归档同时冻结依赖链（审计口径）：该订单的出库单不可作废（作废会回退已发净额）亦不可删除（含归档前已作废的单，物理清理会断审计链）；归档单永不物理清理，其 BOM 引用持续存在，被引用 BOM 不可删除（5.2 引用计数不过滤订单状态）。
    - 归档单从销售订单页移入归档订单页（`menu:archived-orders`，普通菜单），仅供查询；`sales_order_change_log` 记 `ARCHIVE` 事件（request_key 必填、reason 可空），`op_log(action=archive_order)` 记里程碑与归档后快照。
- 订单删除与 BOM 删除（5.2）是用户发起的删除操作；订单及出入库台账的定时物理清理为系统自动通道：
    - 仅超级管理员（受保护权限 `orders:delete`）；前端无权限不显示删除入口，后端仍独立校验。
    - 累计已发必须为 0，且没有未删除的出库单。出库单"作废→删除"后立即允许删除订单；仅作废未删除的出库单仍算引用。
    - 删除事务固定先锁 BOM、再锁订单；校验 `row_version` 后打 `deleted_at` 标记并写 `op_log(action=delete_order)`，`detail_json` 保存删除前订单快照。订单立即退出列表与可发量分配，但保留外键及变更日志；7 天后且所有关联出库单已物理清理时，维护任务先删 `sales_order_change_log` 再删订单行。操作日志长期保留。
    - 删除与出库登记、作废竞争同一订单锁，先提交者生效，后提交者返回 409。

### 6.2 出库可发量

同一 BOM 的库存由全部活动（`ACTIVE`）、未删除且未完成的订单共享；已归档及已删除订单不参与分配：

1. 当前库存 = 该 BOM 有效入库 `Σqty_delta` − 有效出库 `Σqty_delta`。
2. 活动订单按交货日期升序、同日按订单号升序。
3. 从库存池依次分配，每单最多分配其 `qty − 有效出库净额`。
4. 目标订单分配量即本次最多可发量；超出返回 409，客户端刷新后重试。

计算与落库必须处于同一事务和同一 BOM 锁内。不得使用前端传来的库存、累计已发或客户名称作为可信数据。

## 7. 出入库流水

### 7.1 `inbound_ledger`

入库由仓管和超级管理员登记。两者拥有完全相同的当天修正规则；作废另有跨天通道（见下）。

- 当记录的 `created_at` 落在当前北京时间自然日内时，可修改 BOM、数量、业务日期和备注，也可将状态改为 `VOIDED`。
- “当天”按服务端将 `Asia/Shanghai` 当日零点换算出的 UTC 半开区间 `[start, nextStart)` 判断，不按用户填写的 `business_date` 判断。这样今天补录昨天业务日期的记录，今天仍可纠错。
- **跨天作废（2026-09 起）**：修正仍限当天（跨日走库存调整，超级管理员也不例外）；作废对持有受保护权限 `inbound:void-any-day`（仅 super）者放开到任意天数，前端对跨天作废弹二次确认警示。库存非负校验对跨天作废同样生效——隔天出库已消耗该批库存时拒绝。
- 作废不是 DELETE：原行保留，`status=VOIDED` 后不再计入库存。
- 原登记人和原登记时间不可改；每次修改记录 `updated_by/updated_at` 并递增 `row_version`。
- 每次修改或作废必须填写原因，并在同一事务写入不可变的 `inbound_change_log`，保存完整 before/after JSON、操作人和前后版本；作废另在 `op_log` 记 `void_inbound`。
- 改 BOM 时按 id 升序同时锁旧、新 BOM；改数量、改 BOM或作废后若任一 BOM 库存会变成负数，事务拒绝。
- 仓管和超级管理员同时修改时，先提交者成功，后提交者因版本不一致返回 409。
- **删除已作废单（2026-09 起，软删除）**：权限 `inbound:delete`（默认授仓管，非受保护，super 可按需授予其他角色）。仅 `VOIDED` 可删（作废时库存已扣回）；被 `stock_adjustment.related_inbound_id` 引用的单 409（保证物理清理外键安全）；已删再删 409。删除 = 行打 `deleted_at` 标记、列表接口过滤，**不递增 `row_version`、不写 `inbound_change_log`**（删除是可见性管理而非业务变更，版本链止于 VOID）；`op_log` 记 `delete_inbound` 与删除前快照（含作废原因——从最后一条 VOID 日志捞出冻结）。`deleted_at` 超过 7 天保留期后由 maintenance 定时物理清理：连带 `inbound_change_log` 同删，候选查询以 `NOT EXISTS` 排除仍被调整单引用的行（源头已禁止新调整单关联已删除单），分批 + 每批提交推进。清理为系统自动行为，不写 `op_log`；无恢复接口，7 天内可由 DBA 手工清 `deleted_at` 恢复。

### 7.2 `stock_adjustment`

跨日发现入库错误时，原入库行禁止修改。只有超级管理员可新增库存调整单：

- `qty_delta` 为非零有符号整数，正数增加库存、负数减少库存；负向调整后库存不得小于 0。
- 必须填写原因，可关联原入库单；关联时调整 BOM 必须与原入库 BOM 一致。保存操作人、业务日期、创建时间和幂等键。
- 调整单不可修改或删除；再次出错只能新增反向调整单。

当前库存公式为：有效入库 `Σqty` + 库存调整 `Σqty_delta` − 有效出库 `Σqty_delta`。

建表脚本提供 `v_bom_stock` 与 `v_order_outbound_qty` 作为统一聚合口径。无任何流水的 BOM/订单不会出现在视图中，业务查询必须从主表 `LEFT JOIN` 并用 `COALESCE(..., 0)`，不能把缺行理解为资源不存在。

出库事件自迁移 `20260946000000` 起以 `v_outbound_effective_event`（未软删出库单的全部台账事件，不按 `state` 过滤）为事件级判据单一来源：`v_order_outbound_qty`、`v_bom_stock` 出库臂、BOM 台账流水的出库臂与工作台 movements 统一从该视图取数。作废单净额 = `NORMAL` + 等额 `CORRECTION`（净 0）自然抵消；未来若引入部分冲销，作废单残值即实际出库，同样进入净额与流水（台账流水会成对展示作废单的正向与冲销行，净额与结余恒等）。

### 7.3 `outbound_shipment` / `outbound_ledger`

出库单头只有两个状态：`REGISTERED`（已登记）与 `VOIDED`（已作废）。2026-09 迁移将历史 `PRINTED` 单头回退为 `REGISTERED`（打印不再是状态），该回退不产生 `outbound_state_log` 事件。

- 仓管/超级管理员登记时，在同一事务创建 `outbound_shipment(state=REGISTERED)` 和一条正向 `outbound_ledger`，库存和订单累计已发立即生效。
- 作废是唯一逆向操作：仓管或超级管理员对 `REGISTERED` 单填写作废原因，事务追加等额负向冲销流水并将单头置为 `VOIDED`，库存与订单净额随之恢复；已作废单不能重复作废；作废另在 `op_log` 记 `void_outbound`。
- 未删除的已作废出库单仍可打印（打印件带作废标注）；客户退货必须走后续销售退货入库，原出库事实永久保留。
- **删除已作废单（2026-09 起，软删除）**：权限 `outbound:delete`（默认授仓管，非受保护）。仅 `VOIDED` 可删（作废时已追加冲销、订单已发量已恢复）。删除 = 单头打 `deleted_at` 标记、出库列表与 BOM 库存流水过滤，按单号打印返回 404，不递增 `row_version`、不写状态日志；`op_log` 记 `delete_outbound` 与删除前快照（含原始发货备注、登记人/时点、作废原因），登记发货的 `ship` 日志也冻结原始备注。7 天保留期后 maintenance 物理清理：连带 `outbound_state_log` 与 `NORMAL`+`CORRECTION` 数量流水同删（先删 CORRECTION 再删 NORMAL，自引用外键顺序）；零和冲销对不改变任何统计与订单已发。出库单软删除后，关联订单在净发货为零时可立即软删除（见 6.1）。

同一出库单的有效出库量等于其 `outbound_ledger Σqty_delta`，不得小于 0。冲销事件必须引用原正向事件；原数量事件永不更新或删除。

### 7.4 打印文档输出

打印是无副作用的纯读动作，不再是“放行点”：

- 持有 `outbound:print` 权限者（管理员/超级管理员）可对任意状态（含已作废）的单据发起打印，可重复，不需要原因，不落任何日志、不修改单头状态与版本。
- 后端按请求实时组装文档：单据内容取订单冻结快照（客户名、BOM 编码、规格，不读当前主数据与目录），`state`/`voidReason` 取单头当前值（打印件据此渲染作废标注），`printedBy`/`printedAt` 为本次输出人与时点。
- 无并发控制：与作废同时发生时，打印件可能反映作废前一瞬的状态——纯输出语义下可接受，以单头落库状态为准。
- 纸质签字和安排人员发货属于线下流程，不伪装成系统电子签名。

### 7.5 客户撤单场景（无取消生命周期）

- 未发货不要了：由超级管理员直接删除订单（须净发货为 0 且关联出库单均已删除）。
- 已部分发货后不要了：由超级管理员归档结案，剩余欠量随归档关闭。
- 已登记未作废的出库单需要回退数量：先由仓管/超级管理员作废对应出库单，再删除订单。
- 已离库后客户因质量等原因退货：走销售退货入库，不撤销原出库。

## 8. 日志与不可篡改性

- `op_log` 为集中审计索引（横向："谁在何时对什么目标做了什么敏感操作"），按审计清单覆盖：登记发货（ship）、新建/更新客户、新建/删除订单、归档订单、新建/删除 BOM、入库创建/作废/删除、出库作废/删除；这些日志与业务行同事务提交。`(action, target_id)` 为普通索引（`update_customer` 同目标可多条），重复记录由幂等层防重放兜底。
- 入库当天修改由 `inbound_change_log` 形成审计链；库存调整和出库冲销由追加事件本身形成记录；负责人移交和订单变更分别使用专表记录。`op_log` 快照自包含（含操作人姓名/角色快照），业务行被清理后仍可独立还原"删除时刻的单据终态 + 作废原因"。
- 所有日志、库存调整和出库数量事件不提供人工 UPDATE/DELETE；入库只允许业务服务执行带当天窗口（或跨天作废权限）、版本和日志约束的 UPDATE，以及删除接口对 `VOIDED` 行的 `deleted_at` 标记 UPDATE。订单与出入库单由用户软删除，维护任务在保留期后清理；BOM 无引用时可由超级管理员物理删除，所有删除动作均在 `op_log` 留快照。
- 操作日志保留 `operator_id`，同时保存操作发生时的姓名和角色快照，避免用户改名/改角色后历史展示变化。
- **系统日志聚合端点（`GET /system-logs`，受保护权限 `system-logs:view` 仅 super）**：四来源 UNION ALL——`op_log`（13 种业务动作，含离岗批量移交补写的 `update_customer`；备份/恢复的 `db_backup`、`db_restore` 虽写在同表，但不属于此业务时间线；`customer_owner_history` 仍作归属变更业务表保留但不进聚合）、`sales_order_change_log`（仅 UPDATE，CREATE/ARCHIVE 由 op_log 出，天然去重；订单物理清理时同事务先删日志，FK 保证无孤儿行）、`inbound_change_log`（仅 UPDATE）、`stock_adjustment`（adjust 动作，domain 归 inbound）。分批为 `(occurredAt, id)` 复合游标（业务先取 now 后生成雪花 id，并发事务中两者顺序可能倒置）。
- 历史身份漂移口径：op_log 来源展示操作时姓名/角色**快照**；change_log/调整来源的操作人 join `sys_user` 展示**当前**姓名与角色，随改名/改角色漂移属可接受（不加快照列，避免过度设计）。
- 关键词按操作人姓名、目标编号、目标名称三项 LIKE。名称命中依赖快照存在——存量 `create_order`/`ship` 等旧日志无名称快照，按名称搜不到属预期降级（按编号/操作人仍可命中），不做历史回填；新事件（2026-09 起）写入时携带名称快照。
- 系统日志对上述业务动作是当前留存策略下的全量覆盖：订单/入库的编辑明细日志随订单物理清理而消失，属有限留存而非永久历史审计。`sys_grant_log`/`sys_user_change_log`（权限域已有专页）、`outbound_state_log`（ship/void 已由 op_log 覆盖）及系统备份/恢复审计动作不进聚合。
- 历史查询性能基准（2026-09-27，加入 13 种业务动作过滤前；生产备份副本、30 天窗口 145 候选行）：四臂 UNION ALL 全局排序取 21 条 EXPLAIN ANALYZE 实测 **0.576ms**（op_log 全扫 139 行 0.158ms + change_log 臂 join 0.112ms）。当前查询已增加业务动作过滤，不能把该数值当成变更后的实测；数据量显著增长时按同口径复测再决定是否优化。

## 9. API 与查询索引

必须存在的关键索引已写入建表脚本，包括：

- 客户：`owner_id`、名称；
- 订单：`(bom_id, lifecycle_status, deliver_date, order_no)`、`(customer_id, order_date)`；
- 入库：`(bom_id, status, business_date, id)`；库存调整：`(bom_id, business_date, id)`；
- 出库单：`(order_id, state, business_date, id)`；出库数量事件：`(shipment_id, business_date, id)`；
- 入库修改、负责人历史、订单变更、出库状态与授权日志：业务主键 + 时间；
- 所有业务编码、账号、幂等键及 BOM 指纹唯一键。

工作台数据由 `/workbench/overview` 聚合端点统一供给（产品含 v_bom_stock 库存、订单含 v_order_outbound_qty 净额、出入库按业务日聚合）。台账和订单列表启用分页前，应先按需增加库存、趋势、欠量等后端聚合端点，不能用分页后的局部数据计算全局库存。

## 10. 应用内数据库备份/恢复（仅超管）

超管专属功能：菜单「系统」→「备份」「恢复」；引擎与校验同时供 CLI（`pnpm restore-database`）应急通道复用。业务组闭包含 `sys_user`（bcrypt 哈希）——**备份文件按机密保管**。

### 10.1 分组与文件格式

- 分组目录单一来源 `src/system/backup.catalog.ts`：8 组（users/sequences/customers/bom/orders/inbound/outbound/system），入库↔出库互为依赖（v_bom_stock 口径），bom 依赖 sequences（nextBomCode INSERT IGNORE）。完整备份＝目录全集（动态计算）。`sys_permission`/`api_idempotency`/`sys_restore_job` 永不入备份。
- 格式 `zmsys-backup v1`：UTF-8/LF、一行一语句、仅数据不含 DDL。固定头/meta（JSON）/`SET NAMES utf8mb4;`/表段/INSERT/checksum/尾标记；checksum 为 header 后至 checksum 行前全部行的 sha256。表按 information_schema FK 拓扑序输出；自引用表（material_group/stock_adjustment/outbound_ledger）按递归深度父先子后、同层主键序。批次 ≤1000 行/1MiB，单行 ≤8MiB；解压上限 2GiB、上传 512MiB（nginx 总请求体 513m）。
- 保真纪律：备份/恢复专用一次性连接固定 `bigIntAsNumber:false / decimalAsNumber:false / jsonStrings:true / dateStrings:true` + UTC。业务 JSON 列保持数据库原文（禁止 JS parse→stringify 往返，大整数会静默改值），DATETIME/DATE 保持原文（不经本地 Date）。schemaFingerprint（列全量类型/可空/默认/排序规则、主键、唯一索引、FK、CHECK 的规范化摘要）与 latestMigration 均须一致才允许恢复；serverProduct/大版本一致（v1 仅同构库）。

### 10.2 两模式与冲突分诊

- **merge（默认）＝日常补缺**：单事务层级序参数化插入。PRIMARY 冲突二分到行逐列比对——JSON 列用数据库 `<=> CAST(? AS JSON)`（区分 SQL NULL 与 JSON null、大整数精确、对象键序不敏感），文本族按 `CAST(... AS BINARY)` 字节比较，其余无损类型比较；差异 ⊆ 豁免列（sys_user 为 last_login_at+updated_at，其余表仅 updated_at）→ 跳过保留目标值，否则中止回滚（报告表/键/差异列）。非 PRIMARY 唯一键冲突 → 中止回滚（报告索引名）。`biz_sequence` 特例 `INSERT ... ON DUPLICATE KEY UPDATE next_value = GREATEST(next_value, ?)`。
- **replace ＝完整数据快照还原**（仅完整备份）：范围外引用预检（FK 图 + EXISTS；可清理运行表 api_idempotency 除外）→ 事务内保存恢复前 token_version、DELETE api_idempotency → FK off 逆序整表 DELETE → FK on 按文件序插回 → 范围内 FK 孤儿复核 → 同事务写成功凭证。重跑会删掉两次备份之间新增的数据（文案明示）。不提供 binlog 任意时间点恢复。
- **replace 的会话例外**：每用户写 `token_version = max(恢复前目标值（无则 0）, 备份值) + 1`，其余字段按备份还原；恢复后所有用户须重新登录。merge 不改会话版本也不豁免其冲突。灾后重建库（空库先跑同版本迁移再 CLI replace）若已丢失原会话版本，必须更换部署 JWT_SECRET 再重建 backend 容器（`docker compose up -d --no-deps --force-recreate backend`），随后重载 frontend 的 nginx。
- **空库初始化**：灾后先跑同版本迁移再 CLI replace，不能把备份文件直接导入裸空库。mysql 客户端仅用于 scratch 库格式验证（去 DEFINER、保留 sys_permission、清空备份范围表、固定 UTC 与兼容 sql_mode）。

### 10.3 提交幂等与凭证表

- `sys_restore_job`（无 FK、replace 不清空、不随备份导出）：id Snowflake、request_key VARCHAR(64) UNIQUE（ascii/ascii_bin）、file_sha256（上传文件原始字节摘要）、mode、status ENUM(SUCCEEDED/SUCCEEDED_AUDIT_FAILED/FAILED)、operator、report_json、error_text、created_at/finished_at。**成功凭证与恢复数据同事务提交**；FAILED 行在确认未提交后单独补写。不能以“任意行存在”判断已提交。
- **requestKey 提交身份**：POST run 算摘要后查 key——同文件同模式 → 200 原终态；异文件/模式 → 409。无行 → 完整预检 → 原子占内存任务槽 + 零等待 GET_LOCK（锁名含库名摘要 ≤64 字符；占用 409 不排队）→ 锁内复查 → 内存 RUNNING、接管文件、返 202。重新执行＝结果确认后新 key+重输 ack；UNKNOWN 不允许。
- **查询语义**：`GET jobs/key/:requestKey`（维护期放行）无持久行时返回 404 NOT_FOUND——只表示当前未查到，不是终态（原请求可能仍在上传/预检）；客户端保留同一 key 继续查询或明确重提同文件/模式/key。数据库不可达是 5xx。RUNNING/UNKNOWN 只在进程内存。
- **UNKNOWN 核实**：COMMIT 回执丢失/断线/回滚失败 → 内存 UNKNOWN（保持维护态），销毁原连接后新连接取得同一恢复锁再查凭证——有成功行即成功；锁在手且无成功行（旧会话已结束）才记 FAILED。禁止自动重跑或用 FAILED 覆盖成功行。

### 10.4 维护态与任务化

- MaintenanceGuard 先于 JWT：请求记录当前 generation，维护激活时仅放行只读白名单（GET auth/profile、system/backup/catalog、system/restore/jobs/*、health/live），其余 503；激活时 generation 递增。配套拦截器在全部 guard 通过后原子检查「非维护且代次一致」才登记写请求（含登录、backup/run），跨过一次恢复的旧鉴权请求 503；计数在 handler/DB 实际结束后释放，HTTP 断线不提前释放。恢复前排空 60s 未果且未执行则失败。
- 进程启动先短暂取得恢复锁再开放业务写与 purge；拿不到则保持维护态等待旧会话结束。台账清理（maintenance）维护期不启动新批次（purgeActive 标志覆盖首查到最后事务）。
- op_log 扩 `db_backup`（发起备份即记，不当下载成功凭证）与 `db_restore`（确认成功后经 PrismaService 补记；失败把凭证标 SUCCEEDED_AUDIT_FAILED，再失败保留成功凭证只记服务日志）。

### 10.5 CLI 与演练

- `pnpm restore-database [--local] [--replace] [--yes] [--request-key <key>] <文件>`：--local 与容器同一薄入口（`apps/backend/src/system/restore-cli.ts`，进程 UTC 初始化，stdin 专用于备份字节）；默认远程＝一次 SSH → backend 镜像临时命令容器 `docker compose run --rm -T --no-deps backend node dist/system/restore-cli.js ...`，先检查 backend 已停、目标库与本地确认值一致，确认在本地外壳完成。**停写前提**（backend/其他写入进程已停、暂停部署迁移）不因 --yes 绕过。
- `--reset-password <account>` 独立救援改密：不要求重跑恢复；停写后取得同一恢复锁，新密码经 stdin 隐藏传入（不走 argv、不记录），复用口令规则（6-128 位），更新 bcrypt/password_changed_at/token_version/row_version 并记用户变更日志。现有 users 重置接口禁止 super，本救援入口不沿用该限制。
- `pnpm restore-drill` 对 `*_test` 双轨演练：replace 轨（自引用三层且子 id 小于父、幂等清理、字段还原、token_version、序列、凭证）+ merge 轨（补插/GREATEST/分歧回滚）+ 四项故障注入（同 key 回放、COMMIT 回执丢失核实、提交后崩溃凭证可查、回滚中重启后同 key 重跑）。
