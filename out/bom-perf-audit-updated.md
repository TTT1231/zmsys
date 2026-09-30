# BOM 加载与表格交互性能审计报告（实测版）

- 复审日期：2026-09-30；源码复审基线 `fbe40ed`，实测采集时工作区 HEAD `0143bf7`（`git rev-parse --short HEAD` 验证；`git diff --stat fbe40ed..0143bf7 -- apps/frontend` 为空，两者仅隔一个后端 sys-logs 提交）。本文行号对应该区间内的前端实现，与实测代码一致。
- 目标：减少 BOM 页面及相关选择器的不必要数据加载、主线程计算和 DOM 挂载，改善首载、搜索、刷新与表格交互。
- 状态：**P2 已于 2026-09-30 晚实施并通过同基准复测验收（见 §3“实施与复测”）；其余 P1/P3/P4–P7 仍未实施。** 已核对源码、完成受控组件验证，并采集本机受控环境（生产构建、量级梯度）的微基准与端到端轨迹。2026-09-30 晚完成第二轮修正复测（v2）：修复搜索计时跨键错误归因与 trace 嵌套重复计数两处采集缺陷，补齐 P3 真实导航路径、P4 单/双分支配对、P6 更新期耗时、P7 受控两遍（非空/空）与 usage 并发配对照；v1 数据归档于 out/perf-lab/archive-v1/（缺陷清单见其 README）。生产网络、真实用户设备与多用户负载仍未覆盖（见“实测记录”的未覆盖清单）。
- 证据分为“源码事实”“组件验证”“实测记录（本机受控环境，2026-09-30，v1/v2 两轮）”。下文 P1–P7 是问题编号，保留旧报告编号供追踪，不代表严重等级；实测后的优先顺序见 §6。
- 关于“BOM 当前加载卡顿”：本机受控环境在 1x 档（≈生产量级）**未复现卡顿级异常**（最慢交互为工作台→BOM 导航 3.2s、冷启动 1.3s；除 refresh-stale（无长任务）外各场景 longTaskMax 63–175ms）。用户实际遇到的卡顿发生在哪个操作、哪个阶段**尚未定位**；下一步应转向实际使用路径与设备取证（见 §6“下一步”），而不是继续在本机扩大量级。
- 数据口径：本报告字节均为未压缩 API 口径（采集用自写反代原样透传 API 响应）；生产 nginx 对 application/json 开 gzip（[配置](scripts/deploy/nginx.conf#L9)，仓库配置事实，未现场核验），生产实际传输字节会小于本报告数值，收益上界按未压缩口径陈述。

## 1. 结论与归因边界

已确认的问题是：BOM 使用关系依赖三个全量业务列表；工作台快照与 BOM 独立查询重复获取资源；主表同时挂载桌面和移动两套当前页内容；搜索和部分行展示存在重复计算；使用筛选在特定加载阶段会卸载表格。入库弹窗中的 BomPicker 还存在结果全量挂载问题。

**不能把“多个 HTTP 请求”“React 重渲染”“重新创建整张表格 DOM”当作同一件事。** 创建新的 React element、调用 `cloneElement` 或执行组件函数，不等于替换已有 DOM。同位置、同类型且 key 稳定的节点通常可以复用；是否真正卸载应观察组件生命周期或 DOM 节点身份。参见 [React：Render and Commit](https://react.dev/learn/render-and-commit)。

**实测总判定（2026-09-29 生产备份量级：40 BOM/39 订单，≈e2e 1x 档甚至略小）——按“观察到什么 / 能归因多少 / 尚未确认什么”陈述。** 观察到：1x 档冷启动 1261ms、订单派生 counts.ready 全量 ≈1.0–1.2ms、搜索每键交互 16–64ms（Event Timing，v2）、BOM 页无 >175ms 长任务；P1–P7 各自的已测成本在当前量级均低于“可感知”口径（50ms 长任务/秒级等待）。能归因：P2 是最早且最陡的上量拐点（约 10x 订单量首次可感知：切 tab 1090ms + 777ms 长任务；50x 页面冻结 55.7s；100x 45s 未完成——超时口径）；P3 重复获取已在真实导航路径实测坐实（入库页→BOM 五类资源全部重取，v2）；P4 双份布局在 pageSize50 更新路径有稳定 +46ms 差值与 +1206 DOM 节点（配对实测，v2），冷挂载路径未检出稳定差异；P1 字节随 BOM 数线性（≈1.7KB/BOM，v1 口径）。尚未确认：① 1x 档除 refresh-stale（无长任务）外各场景仍有 63–175ms 的 longTaskMax 未归因（是否属首载渲染/脚本成本未验证，原始 trace 已落盘 v2/traces/ 可查）；② 用户实际遇到的“BOM 加载卡顿”未在本机复现，其原因不能由本数据回答；③ P4 的 46ms 更新差值在默认 pageSize10 下的对应值（未单独测，按行数比例约 ~9ms）。修订后的实施顺序把 P2 提到首位（数据依据强于其他项），P4/P6 维持末段但理由更新为“更新路径有稳定小成本、无首因证据”，见 §6。

| 层面             | 本次确认的风险                                     | 不能由此直接推出的结论                                   | 2026-09-30 实测判定                                                        |
| ---------------- | -------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| 数据传输         | 全量明细、跨缓存重复请求，规模随业务数据增长       | 每个响应都会重新挂载一次表格                             | P1 字节线性（1x 六接口 136,589B → 100x /boms 单接口 6,908,234B，v1 口径）；P3 已在真实导航路径实测坐实：入库页→BOM 五类资源各重取一次（v2 consumer-then-bom）；工作台页走 overview 聚合、该路径无重复（已实测）；当前量级冷启动 1261ms、无可感知等待 |
| 主线程计算       | 非空搜索重建检索文本；父页面更新可能重复计算行摘要；订单派生重复计算 | 每次局部 state 变化都会重算全页；DOM 必定重建            | P2 当前 1.02–1.18ms/遍（三轮）、约 10x 订单量起可感知（切 tab 1090ms + 777ms 长任务，v1）；P5 搜索每键交互 16–64ms（Event Timing，v2，含输入延迟+处理+至下一次绘制）；P6 父级更新（usage 到达）整页 update 当前量级上界 16.3–17.1ms（池 40，pageSize10，两轮）、池 ≥400 档 2.9–3.8ms（micro p6-page-update） |
| DOM 挂载         | 两套当前页内容；选择器全量结果；加载分支替换表格   | BOM 主表没有数量约束；隐藏内容的布局绘制成本等于可见内容 | P4 配对实测（v2）：pageSize50 更新路径 dual−single 稳定 +46ms（5/5 对同号，中位）、隐藏分支 +1206 DOM 节点；冷挂载路径差值中位 1ms（噪声级，臂内极差 25ms）；P7 重挂在受控两遍（非空/空）均断言复现，处理段上界 313–328ms（含采集轮询粒度 ~250ms）且窗口内无 >50ms 长任务；选择器真实流程最大品类 11 项@1x（v1 100x 78 项受造数 √F 品类分布影响，见 P5） |
| 浏览器布局与绘制 | 列宽变化、表头测量、属性更新                       | 已被 same-check 或 rAF 完全消除                          | 拖列宽 1x 档 0 次慢帧（v2）、1x–100x 均 0–1 次（v1，帧间隔>25ms 口径），未见异常；v2 已停用自动分桶的 layout/paint/script 聚合数字，原始 trace 落盘待定向检查 |

### 实测判定摘要（按修订后优先顺序）

| 顺序 | 问题 | 判定             | 当前量级实测成本                                  | 拐点                                                        |
| ---- | ---- | ---------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| 1    | P2   | 上量后瓶颈（证据最强） | counts.ready 全量 1.02–1.18ms/遍（micro n=40 三轮）；e2e 1x 切 tab 353–360ms | ≈10x 订单量（~390 单）首次可感知（切 tab 1090ms + 777ms 长任务，v1）；50x（~1950 单）页面冻结；100x（~3900 单）45s 内未完成（waitForSelector 超时口径，不排除仍在缓慢推进） |
| 2    | P1   | 上量后瓶颈       | 六 GET 共 136.6KB、冷启动 1261ms；usage 并发对首显无可测影响（配对照差值 −7ms ≈ 噪声，v2） | 体验拐点到 100x 未测得（冷启动 2346ms，场景成功完成——本报告未定义用户可用性标准，v1）；资源拐点线性，/boms 过 1MB 约在 ~620 个 BOM（≈当前 15x；按 10x–100x 造数密度 ≈1.7KB/BOM 线性外推，对明细与名称密度敏感，见 §5.2） |
| 3    | P3   | 上量后瓶颈（真实路径已实测） | 入库页→BOM 五类资源各重取一次（v2 consumer-then-bom 实测），1x 档重复 ≈136.0KB（五类）、导航 1142ms | 门控多等 68.4ms@1x → 1,313.9ms@100x（v1 上界口径）；按“可感知”口径 50x 的 0.77s 接近秒级等待、100x 超过 |
| 4    | P7   | 当前量级可忽略（结构缺陷） | 受控两遍均断言“切筛选→表格卸载→释放→重挂”（v2）；处理段上界 313–328ms 含采集轮询粒度 ~250ms、窗口内无 >50ms 长任务；micro 整页 update 口径 16.3–17.1ms（池 40，pageSize10，两轮） | 结构上 1x–100x 全档复现（v1 tableRemounted 均 true）；时间成本无拐点（无 >50ms 长任务） |
| 5    | P5   | 当前量级可忽略   | 主表搜索每键交互 16–64ms（Event Timing v2，5/5 键上报、中位 32ms；构成=输入延迟+React 处理+至下一次绘制）；选择器组件挂载 2.7–3.1ms（micro 40 项全匹配，三轮） | 主表搜索 micro 口径 4000 BOM 三轮均 <22ms、10000 BOM 三轮 30.9–54.1ms（阈值噪声区，不足以定拐点）；选择器全匹配 400 项三轮 33.2–51.9ms（跨阈值区间）、2000 项 149–171ms 确定性超阈值；真实品类收敛流程 1x 最大 11 项 |
| 6    | P4   | 当前量级小成本（更新路径稳定） | pageSize50 更新 dual−single +46ms（中位，5/5 对同号）+ 隐藏分支 1206 DOM 节点；冷挂载差值 1ms（噪声）；默认 pageSize10 对应值未单独测（按行数比例约 ~9ms） | 冷挂载未检出稳定差异；更新路径差值随行数线性（pageSize50 实测 46ms），无超阈值拐点证据 |
| 7    | P6   | 当前量级可忽略   | 父级更新（usage 到达）整页 update：当前量级上界 16.3–17.1ms（池 40，pageSize10，两轮）；池 ≥400 档 2.9–3.8ms（pageSize10）/ 10.1–11.9ms（pageSize50）；池 10000 档 ~22ms（两轮可复现的 O(池规模) 分量） | 挂载分量被分页封顶（三轮 1.16–2.92ms@ps10）；更新口径随池规模增长（~22ms@10000）但均 <50ms |

各问题收益均为“由实测成本推出的上下界”；未实施修复，真实收益待实施后同法复测。

### BOM 页面加载到渲染的实际链路

源码：[查询入口与加载门控](apps/frontend/src/pages/bom/BomPage.tsx#L815)、[usage 的 Promise.all](apps/frontend/src/data/queries.ts#L101)、[表格条件渲染](apps/frontend/src/pages/bom/BomPage.tsx#L1043)。

| 场景                                           | 当前行为                                                              | DOM 判断                                                   | 实测对应                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| 冷启动，默认“全部状态”，请求正常成功           | boms、categories、stocks 三个必需查询加载期间显示占位；usage 同时请求 | 必需查询未齐时没有 DataTable，不能按请求数推算表格挂载次数 | e2e bom-cold-start 确认门控只依赖 boms/categories/stocks，usage 三接口在旁路；1x 到表格稳定 1293ms（v1）/1261ms（v2） |
| usage 在表格出现后完成，仍为“全部状态”         | 更新引用集合和行底色；`unusedCodes` 变化还会使筛选 memo 失效          | 组件验证中，原表格、行及行内节点均复用                     | 未单独采样行底色更新耗时                                                  |
| 已有数据时后台刷新，响应内容相同               | 走 `isFetching && !isLoading` 的延迟遮罩                              | 组件验证中原表格保留；实际行数据增删仍可造成局部 DOM 增删  | e2e bom-refresh-stale：35s 过期重进 1x 共 4 请求 740ms，遮罩 200ms 内不闪现 |
| usage 初次请求未完成时切到“未使用”或“正在使用” | usage 加入 `isLoading` 条件，表格改为占位，完成后显示筛选结果         | 会卸载并重新挂载 DataTable，见 P7                          | e2e bom-usage-filter：1x–100x 四档 tableRemounted 均为 true               |
| 翻页或筛选改变当前行集合                       | 按新的 `pageRows` 输出行                                              | 部分行增删属于正常行为，不能与整表卸载混为一谈             | 搜索场景行数 10→1，属正常行为                                             |

## 2. BOM 主线问题

### P1：使用关系依赖三个全量列表；BOM 本身也全量携带明细

**源码事实。** 缓存为空、请求成功且不计重试、公共布局请求和用户操作时，BomPage 的四个查询会发起六个 GET：`/boms`、`/bom-categories`、`/bom-stocks`、`/orders`、`/inbound`、`/outbound`。`useBomUsage` 将后三个请求放在同一个 `Promise.all` 中，全部完成后才返回 usage 数据，不是三个独立的成功数据提交。

- [BOM 列表](apps/backend/src/boms/boms.service.ts#L118)：没有分页，包含每个 BOM 的全部 `items`。
- [订单列表](apps/backend/src/orders/orders.service.ts#L49)、[入库列表](apps/backend/src/inbound/inbound.service.ts#L52)、[出库列表](apps/backend/src/outbound/outbound.service.ts#L64)：没有分页，均排除 `deletedAt != null` 的行；返回数据仍包括未软删除的归档订单或作废单据。
- [品类目录](apps/backend/src/boms/boms.service.ts#L93)包括目录物料，规模随目录增长；[库存映射](apps/backend/src/boms/boms.service.ts#L131)按 BOM 聚合，返回规模随有流水的 BOM 数量增长。它们比完整业务流水紧凑，但不能表述成“固定大小、永不增长”，也不能据返回体小断言后端聚合成本小。
- [缓存配置](apps/frontend/src/main.tsx#L11)为全局 `staleTime: 30_000`、`retry: 1`、关闭窗口聚焦刷新；[BOM 和品类](apps/frontend/src/data/queries.ts#L59)的 staleTime 为五分钟。因此不是每次进入页面都固定发六个请求；缓存状态、主动失效和重试会改变实际请求数。

**实测（2026-09-30，本机受控环境，口径见“实测记录”）。** 1x 档（seed 60 BOM/40 订单/20 客户，略高于生产 40/39/20）bom-cold-start：六个业务 GET 合计 136,589B（未压缩口径：/boms 76,960B、bom-categories 20,593B、bom-stocks 566B、orders 12,468B、inbound 15,957B、outbound 10,045B），最慢单接口 /api/bom-categories 47.3ms、冷启动到表格稳定 1293ms（均为 v1 轮；v2 复测 48.1ms/1261ms）；e2e notes 确认表格门控只依赖 boms/categories/stocks，usage 三接口在旁路——当前量级 P1 不产生可感知等待。字节随 BOM 数线性（≈1.7KB/BOM）：/boms 676,412B@400 → 3,440,896B@2000 → 6,908,234B@4000；接口时延 125.4ms@400 → 507.1ms@2000 → 940.4ms@4000。由线性外推，/boms 过 1MB 约在 ~620 个 BOM（≈当前 15 倍）。100x 档冷启动 2346ms、整页传输 11,396,663B——BOM 页体验到 100x 场景仍成功完成，体验拐点未测得。35s 过期重进（bom-refresh-stale）1x：4 请求共 42,236B、740ms，其中 usage 三接口并行各 20.7–26.4ms；四档行为一致，重进阶段均重取 stocks 与 usage 三接口（50x/100x 轨迹 notes 的“orders×0/outbound×0”为行数稳定时刻的快照计数、早于在途请求完成，与收尾快照矛盾，以收尾快照 apiTimings/apiRequestCount=4 与 transferBytes 为准，详见 §5.2）。

**保留功能的约束。** [引用集合与删除入口](apps/frontend/src/pages/bom/BomPage.tsx#L851)同时服务于使用筛选、未使用行底色和删除入口判断。仅在用户选择“未使用”时启用 usage，会让默认列表缺少这部分依据。默认“全部状态”不把 usage 在途状态计入页面加载遮罩，但一次底色更新本身不能证明发生了卡顿。

**建议，尚未实施。** 提供 BOM 使用关系的轻量聚合接口，替代三个完整列表。可按 BOM 返回状态或去重后的编码集合；具体 SQL、索引与执行计划另行验证，不预设“一条 distinct 查询”就一定高效。接口必须明确以下不同规则：

| 含义             | 当前依据                                                   | 聚合时应保持的边界                                           |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| 列表“正在使用”   | 未软删除的订单、入库、出库记录中出现该 BOM                 | 归档/作废不自动排除；库存调整不计入这个筛选                  |
| 前端显示删除入口 | 有删除权限，引用与库存数据已返回，无上述引用且库存为零     | 只是入口预判，未知状态不能当作无引用                         |
| 后端允许物理删除 | 删除事务检查仍存在的订单、入库、库存调整记录，另有外键约束 | 包括保留期内尚未物理清理的软删除记录；“未使用”不等于“可删除” |

依据：[后端删除校验](apps/backend/src/boms/boms.service.ts#L379)、[业务权限与删除规则](docs/business/roles.md)。若聚合接口提供删除阻断信息，应与后端规则对齐，最终删除仍由事务重新校验。新增接口的权限及契约需同步核对 [roles.md](docs/business/roles.md)、[db-scheme.md](docs/db-scheme.md) 和 [openapi.yaml](docs/openapi.yaml)。

**收益边界（由实测成本推出；未实施修复，真实收益待实施后同法复测）。** 当前量级上限：省 usage 三接口 38,470B/次（12,468+15,957+10,045，e2e-1x bom-cold-start apiTimings，v1）与 35s 过期重进时的 3 个重复请求（墙钟收益 ≤~26ms，三接口并行各 20.7–26.4ms，v1）；表格首显：usage 三接口延后 10s 的交错配对照实测差值 −7ms（中位，轮间极差 112ms 为噪声量级，v2 bom-cold-start-pair）——在本机 localhost 栈下 usage 并发对首显无可测影响；该结论不能外推到生产网络（带宽竞争、RTT 未覆盖），只能说“未测得影响”而非“无影响”。/boms 明细瘦身上限 76,960B@60 BOM（生产 40 BOM 未单独实测）。100x 上限：省 3,778,414B（1,210,559+1,592,963+974,892）与刷新路径三接口重取时延（各 465.7–762ms，e2e-100x bom-refresh-stale apiTimings，收尾快照口径，v1）。

### P3：跨工作台与 BOM 查询重复获取五类资源

**源码事实与组件验证。** [工作台快照](apps/frontend/src/data/queries.ts#L117)直接调用各 API 函数，结果存在 `["wb", { includeCustomers, includeUsers }]` 下；BOM 列表、品类使用各自的 [bomKeys](apps/frontend/src/data/queries.ts#L51)，usage 使用 `["wb", "bom-usage"]`。直接调用同一个 API 函数不会自动复用另一个查询的缓存。

因此在快照已取得数据、BOM 独立缓存仍为空时，进入 BOM 页会再次获取 **BOM、品类、订单、入库、出库** 五类资源。组件实验确认了这一行为，即使快照缓存仍新鲜也会发生。快照按权限发起六至九个请求，不宜固定写成八至九个。**消费者范围澄清（本轮源码复核）**：`useWbSnapshot` 的消费方是入库、订单（含归档）、出库、客户、权限、系统日志与工作台搜索等页（如 [OrdersPage](apps/frontend/src/pages/orders/OrdersPage.tsx#L78)、[InboundPage](apps/frontend/src/pages/inbound/InboundPage.tsx#L116)）；**老板工作台页（WorkbenchPage）不消费 useWbSnapshot**，改经[后端聚合端点 /workbench/overview](apps/frontend/src/api/workbench.ts#L6) 单请求取数。因此“跨页重复获取五类资源”的真实路径是 useWbSnapshot 消费页 → BOM 页，不是工作台页 → BOM 页。

**实测（v2 补真实导航场景，v1 更正工作台误读）。** v2 新增 consumer-then-bom 场景（e2e-1x）：入库页阶段发起 10 个 API（快照特征：/api/orders、/api/boms、/api/bom-categories、/api/customers、/api/inbound、/api/outbound、/api/stock-adjustments、/api/users、/api/customer-owner-options，另 auth/profile×2）；侧边栏导航到 BOM 后 BOM 页再次请求六个业务接口——**两阶段都出现的接口（真实重复获取）：/api/boms、/api/bom-categories、/api/orders、/api/inbound、/api/outbound 五类各 ×1**，导航到表格稳定 1142ms。P3 的重复获取自此有导航级实测证据，不再是纯组件实验推算。v1 workbench-then-bom 四档 apiTimings 证实：工作台页阶段仅发 /api/workbench/overview（1x 33,790B@26.8ms → 50x 1,462,794B@537.5ms → 100x 2,808,407B@826.5ms）与 /api/auth/profile；导航到 BOM 页后六个业务接口各请求 1 次——**每路径恰 1 条、无重复 HTTP**（已核验四档 apiRequestCount=9 = overview 1 + BOM 页 6 + profile×2）。重复获取成本以“BOM 独立缓存为空时的六接口载荷”为上界：五类 136,023B@1x / 5,547,476B@50x / 10,995,745B@100x（另 stocks 52,811B@100x 为 BOM 页必需首取）、可省门控等待最长 68.4ms@1x（bom-categories）→ 767.4ms@50x → 1,313.9ms@100x（v1）；按本报告“可感知”口径（50ms 长任务/秒级等待），10x 的 192.5ms 未达口径、50x 的 0.77s 接近秒级等待、100x 超过。

**需要排除的误判。** 同一 QueryClient 内、相同权限参数下，多个 `useWbSnapshot` 消费者使用相同 key；实验中两个同时挂载的消费者共享请求。页面和弹窗都调用该 hook，不构成额外缓存割裂的证据。数据过期、主动失效等正常刷新另计。

**建议，尚未实施。**

- 优先用 P1 的聚合接口移除 BOM 页对三类完整业务明细的依赖；不要为了“共享”又让 BOM 页依赖完整工作台快照。
- 对确实需要共享的 BOM、品类等资源，定义统一的资源级 queryKey、queryFn 和缓存策略，快照从这些资源组合数据。相同 key 必须对应相同数据契约；不能把当前 Snapshot 与 usage 的不同返回结构直接改成同一个 key。
- 同时更新 [刷新与 mutation 失效规则](apps/frontend/src/data/queries.ts#L178)，覆盖聚合数据、资源缓存及组合结果。仅让快照调用 `fetchQuery`、却继续只失效旧快照 key，可能读到仍被判为新鲜的旧资源。

**收益边界（由实测成本推出；未实施修复，真实收益待实施后同法复测）。** 重复获取仅在 useWbSnapshot 消费页→BOM 页、且 BOM 独立缓存为空/过期时发生，成本上界为该时刻六接口载荷中的五类部分：136,023B@1x / 5,547,476B@50x / 10,995,745B@100x，可省门控等待上界 68.4ms@1x → 1,313.9ms@100x；工作台页（overview 聚合）→BOM 路径收益为 0（已实测无重复 HTTP）。BOM/品类 staleTime 5 分钟内重进不重复（bom-refresh-stale 仅 4 请求 42,236B）；受共享缓存当时是否仍新鲜制约，不给百分比。

### P4：桌面与移动双份挂载，但主表行数已受分页限制

**源码事实与组件验证。** [pageRows](apps/frontend/src/pages/bom/BomPage.tsx#L914)先切片，再分别用于 [移动卡片](apps/frontend/src/pages/bom/BomPage.tsx#L1003)和 [桌面表格](apps/frontend/src/pages/bom/BomPage.tsx#L1043)。[CSS](apps/frontend/src/index.css#L675)仅隐藏当前视口不使用的分支，不会阻止 React 挂载它。

[分页选项](apps/frontend/src/components/ui/Pagination.tsx#L34)为 10、30、50。实验输入 1000 个 BOM 时，默认挂载 10 行表格和 10 张卡片；切换每页 50 条后为 50 行和 50 张卡片，共 100 个 BomCell 实例。**100 是行内容实例数量，不是总 DOM 节点数量；两种布局的子树结构也不相同。**

冗余成本包括隐藏分支的组件执行、节点创建与内存；不能直接推导布局绘制工作翻倍。也没有依据断言默认十条“必然无感”。

**实测（v2 配对实验 + micro 双口径）。** **配对实验（v2 bom-layout-pair，1x 档）**：临时给 BomPage 加运行时开关门控移动分支，构建独立实验包 dist-exp（与正式 dist 同一构建管线；源码补丁测量后已还原，diff 存档 out/perf-lab/archive-v1/bompage-single-layout.patch），single/dual 两组用**同一实验构建**、开关经 addInitScript 在首渲染前设置、交替先行共 5 对。结果：**冷挂载差值（dual−single）中位 1ms**（逐对 [17,6,1,-17,-6]ms，dual 臂轮间极差 25ms——差值与噪声同量级，未检出稳定差异）；**pageSize50 更新差值稳定为正**：逐对 [46,48,46,30,48]ms、中位 +46ms（single 臂 up50 稳定于 292–295ms、dual 臂 325–341ms，两臂内部波动远小于臂间差）；**隐藏分支 DOM 节点 +1206**（每页 50 行口径，5/5 对完全一致）。即：双份布局的真实增量集中在**行集合变化的更新路径**（翻页/筛选/搜索改行时，隐藏分支同样重渲 50 个 BomCell 与卡片外壳），冷挂载路径被其它启动成本淹没。默认 pageSize10 的对应差值未单独测（按行数比例约 ~9ms）。**micro 口径（三轮）**：p6-page-summary 挂载分量 pageSize=10 三轮范围 1.16–2.92ms、pageSize=50 为 5.63–16.56ms；**池 40/400 与 ≥2000 档的差异三轮不单调（如 ps10 池400 = 1.263/2.917/1.387ms），池间差异视为噪声主导、不作归因**；p6-page-update（父级更新整页口径）见 P6。e2e bom-column-resize 拖列宽 1x 档 0 次慢帧（v2）、BOM 页 domNodes 726（v2 1x）。

**建议，尚未实施。** 按与现有 CSS 一致的 1024px 断点只挂载一种布局，数据查询、分页、筛选和业务弹窗状态放在稳定的共同父层。复核缩放跨断点、焦点和弹窗交互。主表是否还需要虚拟化由当前页渲染耗时决定；已有分页时，缺少虚拟化本身不等于 DOM 无上界。

**收益边界（由实测成本推出；未实施修复，真实收益待实施后同法复测）。** 单布局改造在 1x 档的省量：pageSize50 行集合更新路径 **+46ms/次**（配对中位，5/5 同号）与 1206 个 DOM 节点（内存与潜在布局/绘制成本——本实验未分解布局绘制份额）；pageSize10（默认档）按比例约 ~9ms/次（未单独实测）；冷挂载路径未检出稳定收益。收益随行数线性，当前量级不构成 ≥50ms 长任务的消除项；排序列维持第 6（证据强度高于纯组件实验，但量级低于 P7 的正确性问题与 P5 的上量预防）。

### P5：非空搜索重复生成检索文本；入库选择器全量挂载匹配结果

**BOM 主表搜索。** [filtered 的 useMemo](apps/frontend/src/pages/bom/BomPage.tsx#L889)依赖 `boms、keyword、category、statusFilter、unusedCodes`。它不是每次页面渲染都重算；翻页、开弹窗并不会在这些依赖保持不变时触发筛选计算。

[输入框](apps/frontend/src/pages/bom/BomPage.tsx#L944)直接更新 keyword，没有防抖。关键词非空时，对通过前置品类/使用状态筛选的候选 BOM，重新拼接编码、品类、规格和物料文本并转小写；关键词为空时由 `!kw` 短路，不会执行这段拼接。候选规模大、明细长时是计算风险。

**实测（v2 重测，v1 键延迟数据已废）。** **e2e（v2 Event Timing）**：1x 档逐键键入 6 字符关键词（间隔 180ms），5/5 键全部上报（durationThreshold=16，未上报键不补零）：每键交互时长（duration=输入→下一次绘制，含输入延迟、React 处理与绘制等待）16–64ms、中位 32ms；输入延迟与 React 处理均 ≤0.4ms——即每键时间的主体是绘制等待与帧调度，不是检索计算。结果变化按“可见 BOM 编码序列 + 总数”判定：5 键中 2 键结果变、3 键窗口内无更新（无跨键猜测归因）。**v1 的 avg ~90ms / 离群 248.6–288ms 键延迟数据作废**：v1 采集器在前一键无可见变更时会把后一键的 DOM 更新记到前一键的起始时间上（跨键错误归因，v1 场景 notes 亦自认“部分键未单独计时”），v2 每键以 event.timeStamp 与 Event Timing 条目独立绑定后，同场景同量级实测为 16–64ms——原“离群键来源未定位”的问题定性为采集缺陷，非页面行为。**micro（三轮）**：p5-search-filter（挂真实 BomPage、关键词空→非空、Profiler actualDuration(update)，含检索重建+筛选+结果重渲的整页口径）：n=40 每键 5.5–7.2ms（三轮 5.492/7.219/5.871）、n=400 6.1–8.3ms、n=2000 10.6–27.0ms、n=4000 16.4–21.7ms、n=10000 30.9–54.1ms（晚轮跨过 50ms）。两口径合起来的结论：当前量级检索重建 + 结果重渲 ≤7.2ms，Event Timing 全链路 ≤64ms；到 4000 BOM 三轮均 <22ms，10000 BOM 处于阈值噪声区（两轮 <32.1ms、一轮 54.1ms）——不足以定拐点，但上量后不再是可忽略项。

**BomPicker。** [搜索与列表渲染](apps/frontend/src/components/bom/BomPicker.tsx#L17)对所有匹配项执行 `map`，`max-h-60` 只是滚动容器高度，不减少 DOM。实验输入 1000 条匹配 BOM 时，创建 1000 个选项按钮。当前调用方是 [入库页的新建/编辑选择器](apps/frontend/src/pages/inbound/InboundPage.tsx#L57)，先按品类收敛；它不在 BomPage 的默认列表渲染链上。

**选择器实测。** micro picker-mount（真实 BomPicker 传入全匹配项，Profiler 挂载口径，v2 复测）：40 项 2.671ms、400 项 33.176ms、2000 项 164.413ms、4000 项 282.872ms、10000 项 848.466ms（v1 为 2.725/51.904/149.442/297.884/863.9——400 项两轮 33.2/51.9ms 跨越 50ms 阈值，属噪声区间；“确定性超阈值”的档位是 2000 项起）。e2e 入库选择器按品类收敛：1x 最大品类 11 项（v2）；v1 的 10x/50x/100x 为 19/50/78 项——**该分布受造数模型影响**（品类按 ×√F 增长：100x 时 90 个品类摊薄了选项），不能证明真实业务的选择器余量；若业务保持 9 个品类不变，4000 个 BOM 时最大品类可达 ≥445 项，按 micro 曲线对应 ~35–55ms 量级（已越入接近阈值的区间）。--catalog-fixed 造数档（品类固定 9）已具备工具但未跑（按需定向项）。1x 真实流程“点开品类下拉→选品类→选项渲染完成”251ms（v1 交互墙钟，含 radix 菜单开关与轮询粒度，构成未分解）。

**建议，尚未实施。** 按 BOM 数据变化预生成检索文本，必要时增加防抖或延后结果更新，并验证输入响应。预计算仍占内存，数据很大时应评估服务端搜索。选择器采用分页、可继续加载或虚拟化，保证所有匹配项仍可到达、已选项不会丢失；不可只做 `slice(0, N)` 静默隐藏剩余选项。

**收益边界（由实测成本推出；未实施修复，真实收益待实施后同法复测）。** 搜索预计算+防抖当前最多省 5.5ms/键的检索计算（10000 BOM 也只 30.9ms；Event Timing 全链路 64ms 中的计算份额 ≤6ms，修复对每键体感时间的改善无实测依据）；选择器分页/虚拟化当前最多省 2.7ms/次挂载；若单品类/全匹配达到 400 项省 ~33–52ms、2000 项省 ~150–164ms、10000 项省 ~850ms。均属上量前预防性加固；品类数不增长的业务假设下，选择器是 BOM 侧最早接近阈值的项（~445 项@4000 BOM）。

### P6：行展示与 DataTable 有重复工作，但不是“整表 DOM 重建链”

**源码事实。** [BomCell](apps/frontend/src/components/bom/BomCell.tsx#L9)未使用 `React.memo`，组件执行时会调用 `bomComposition` 与 `bomSummary`。[组合品类分解](apps/frontend/src/data/bomComposition.ts#L12)对组合品类构建目录 Set/Map，非组合品类在第 15 行早退。父页面更新并重新生成行 JSX 时，当前页的两套行内容可能重复执行这些计算。

[DataTable](apps/frontend/src/components/ui/DataTable.tsx#L126)每次 TableView 渲染重新解析 children，随后 [遍历行与单元格并 cloneElement](apps/frontend/src/components/ui/DataTable.tsx#L464)。这会分配 React element、计算样式和执行协调，但当前 BOM 行 key 为稳定的 `bom.code`，单元格 key 为列标识，不能据此认定 DOM 被替换。

**组件验证与范围。** 悬停列宽手柄会更新 TableView 的 `activeColumn` 和列高亮，但实验中未重新调用 BomCell 的摘要函数，行 DOM 保留。该局部 state 更新不向上触发 BomPage；原单元格子元素也可以被复用。因此“悬停会重算全页搜索、订单状态和全部行摘要”不成立。

[BOM 行里的 BomSpecs](apps/frontend/src/components/bom/BomCell.tsx#L66)位于 Modal 内；[Modal 关闭时 return null](apps/frontend/src/components/ui/Modal.tsx#L112)，实验中未执行 BomSpecs。给它加 memo 不能减少这个关闭态列表的物料 DOM，因为这些 DOM 本来就不存在。

**实测（v2 补更新期口径，两轮）。** 行内 bomComposition/bomSummary 的挂载分量由 micro p6-page-summary 界定并被分页封顶：pageSize=10 每页三轮 1.16–2.92ms、pageSize=50 三轮 5.63–16.56ms（一次性挂载计算，池间差异为噪声主导，见 P4）。**更新期分量（v2 新增 p6-page-update）**：挂真实 BomPage 后模拟 usage 数据到达（引用池中一半订单）触发父级 update，整页口径（Profiler actualDuration(update)，含当前页两套行内容重算与 DataTable 协调，jsdom 无布局绘制）：pageSize=10 两轮为 16.3/17.1ms（池 40）、2.9/3.2ms（池 400）、3.0/20.4ms（池 2000，晚轮 20.4 为离群）、3.6/3.8ms（池 4000）、**21.7/22.4ms（池 10000，两轮一致抬升）**；pageSize=50 两轮为 8.2–14.0ms（各池）。pageSize10 池 10000 档的可复现抬升：usage 到达使 `unusedCodes` 变化 → [filtered useMemo](apps/frontend/src/pages/bom/BomPage.tsx#L889) 对全量候选重走一遍筛选（O(池规模)），该分量随池规模增长、与当前页行数无关——这是 v1 “重复触发源未复现”的补测答案：触发源就是 usage 到达（以及任何改变 unusedCodes/keyword/category/statusFilter 的更新），成本 = 全量筛选 O(N) + 当前页行重算 O(pageSize)，1x 量级（池 40）合计上界 17.1ms（两轮 16.3/17.1；池 ≥400 档 ≤3.8ms——池 40 档偏高与挂载口径同模式，未归因）。§5.1 悬停实验中摘要调用未增加的结论不变（局部 state 不触发 BomPage）。

**建议，尚未实施。** 先定位重复计算的实际触发源（v2 已定位为 usage 到达等改变筛选依赖的更新，见上），再对稳定 props 的 BomCell、目录索引和摘要做有针对性的缓存；若要压 O(池规模) 的筛选重走，需按 BOM 数据变化预生成中间结构（与 P5 的检索文本预计算同一机制）。若 TableView 协调或高亮更新在性能轨迹中显著，再拆分表体与交互状态、稳定行 props，或调整高亮实现。仅给接收全新 JSX children 的外层表格套 memo，不保证能跳过工作；memo 也不会减少首次挂载数量。

**收益边界（由实测成本推出；未实施修复，真实收益待实施后同法复测）。** memo/缓存最多省每次父级更新：当前量级（池 40 档）pageSize10 16.3–17.1ms / pageSize50 8.2–9.4ms（池 40 档偏高未归因，保守取该口径）；池 ≥400 档 2.9–3.8ms（pageSize10）/ 10.1–11.9ms（pageSize50）的行重算；池 10000 档另有 ~22ms 中可复现的筛选重走份额（O(N) 分量，预计算/索引化可消除）。当前量级合计 ≤17.1ms/次，不构成可感知成本，排最末（见 §6）。

### P7：usage 未就绪时启用使用筛选，会卸载并重新挂载表格

**源码事实与组件验证。** [usageFilterActive 与 isLoading](apps/frontend/src/pages/bom/BomPage.tsx#L825)结合 [桌面条件分支](apps/frontend/src/pages/bom/BomPage.tsx#L1043)，形成可复现链路：

1. boms、categories、stocks 已成功，usage 仍在初次加载；默认“全部状态”的表格已显示。
2. 用户切到“未使用”（“正在使用”同一门控）。
3. `isLoading` 变为 true，DataTable 被 PageLoading 替换；移动列表也显示占位。
4. usage 完成后重新挂载表格并应用筛选。实验确认新旧 table 不是同一个 DOM 对象。

这是真实的重复挂载路径，但不代表正常 usage 返回或每次后台刷新都走此路径。

**实测（v2 受控两遍重测）。** v2 场景重构为受控时序：usage 三接口挂起（真实响应取回后改写为空引用集）→ 原表格出现 → 切筛选 → **断言原表格已从文档卸载** → 释放 → **断言新表格挂载**；两遍分别覆盖非空（改写后“未使用”=全部 BOM）与空（“正在使用”=0 行）结果。1x 档结果：pass A 非空——切“未使用”后卸载断言通过，释放后重挂（表格元素身份变化）、10 行数据；**受控 usage 等待段**（切→释放，人为挂起，不代表真实网络耗时）422ms，**处理段**（释放→表格回归，含响应解析/派生/调度/渲染，且含采集轮询步进 ~250ms——真实处理耗时的上界为 328ms、下界约 80ms）328ms，窗口内长任务为空。pass B 空——切“正在使用”后卸载断言通过，释放后重挂、空态“没有正在使用的 BOM”判定成立（1 行占位）；等待段 436ms、处理段 313ms，窗口长任务为空。两遍 tableRemounted 均 true。**v1 的 3057/20704/20709/20703ms 总耗时数据作废**：其中 3s 为注入延迟，10x+ 的 ~17.7s 经查为 v1 采集器对不会出现的数据行按钮等满 20s 超时的固定时序（与页面无关）；且 v1 在 10x+ 因造数分布未使用 BOM 为 0，单一遍次无法区分空/非空路径——v2 用响应改写把两种结果都与造数解耦。v1 四档 tableRemounted=true 的结构结论不变。重挂渲染成本由 micro p6-page-update 整页口径界定为 16.3–17.1ms（池 40，pageSize10——对应受控场景的 10 行口径；池 ≥400 档 2.9–3.8ms，池 40 档偏高未归因）；配合“窗口内无 >50ms 长任务”，1x 量级 P7 的时间成本不可感知，属 UX/正确性问题（切筛选后表格短暂消失、显示占位）。

**补充口径。** ① 处理段含采集轮询步进（行数稳定循环每步 250ms），不宜当作精确的页面处理耗时；真实处理成本的独立口径是窗口长任务（空）与 micro 整页 update（16–17ms@池 40）。② 同为 1x 档，真实（非改写）usage 三接口时延 20.7–40.8ms（bom-refresh-stale / bom-cold-start apiTimings，v1）——生产量级真实等待窗口 <100ms。

**建议，尚未实施。** 保持表格框架稳定，将“首次数据加载”“正在取得使用状态”“后台刷新”分别处理。可暂缓应用筛选并明确标注旧结果，或在状态未知时暂时禁用相关筛选；不能将旧结果冒充新筛选结果，也不能把未加载/失败的引用数据当作“未使用”或允许删除。

**收益边界（由实测成本推出；未实施修复，真实收益待实施后同法复测）。** P7 修复最多省本次实测的重挂渲染：整页 update 口径 16.3–17.1ms（池 40，pageSize10，对应受控场景的 10 行，micro p6-page-update 两轮）；1x 受控两遍窗口内均无 >50ms 长任务，无可感知时间收益。等待时长由 usage 数据到达时间决定，属 P1 聚合接口的收益范围，P7 修复本身不缩短；真实慢网下 usage 滞后越久窗口越大，但生产网络 RTT 未测，不能给出生产慢网下的窗口大小。维持轻量 UX 修复定位：先于 P5 仅因修复廉价且消除“切筛选后表格消失/0 行闪烁”的正确性问题。

## 3. P2：订单页存在重复全量派生，实测后提为首修

源码：[OrdersPage 的统计与筛选](apps/frontend/src/pages/orders/OrdersPage.tsx#L711)、[data/views.ts 的派生函数](apps/frontend/src/data/views.ts#L48)。

`counts.ready` 为每个活跃订单调用 `maxShipOf`，而 `maxShipOf` 每次完整执行 `readyToShip`，其中包括订单过滤、排序、BOM 线性查找，再用 `find` 定位订单。最坏情况下存在二次级重复计算并叠加排序、BOM 查找因子。ready 筛选、状态筛选、[桌面行状态](apps/frontend/src/pages/orders/OrdersPage.tsx#L1263)以及 [移动订单卡片](apps/frontend/src/components/ui/MobileList.tsx#L88)还会继续调用相关函数。

**实测。** micro p2-ready-counts（每个活跃订单各调一次真实 `maxShipOf`，等价复走 OrdersPage counts.ready；2 预热 + 9 计时轮取中位数）：n=40（≈生产 39 订单）全量三轮 1.018/1.182/1.026ms——当前量级无可感知成本；e2e-1x orders-page 切“可发货”tab 到行数稳定 360ms（v2；v1 为 353ms，ready 计数均 32）。梯度恶化：n=400 三轮 158.9–190.2ms；e2e-10x（390 订单）切 tab 1090ms 且 longTaskMaxMs 777；e2e-50x（1950 订单）冷加载 31,199ms、切 tab 55,997ms、longTaskMaxMs 55,702、longTaskTotalMs 85,532（v1）；e2e-100x（3900 订单）场景 45s 等待表格行可见超时失败（ok=false）。注意 micro 的 n≥2000 各档为外推预估（8 次真实调用均值 × 活跃单数，notes 明示“预估而非实测中位数”），且 100x 档 e2e 本身失败、无端到端数值，只能用微基准外推对应。v1 报告曾引用的 scriptMs=171,154ms 为已废除的自动分桶口径（嵌套重复计数），不再使用。

**判定。** 这项问题并非 BomPage 渲染期正在执行的计算，当前量级（≈1.0–1.2ms/遍、切 tab 353–360ms）不构成现实卡顿；但它是最早且最陡的上量拐点：≈10x 订单量（~390 单）首次可感知（切 tab 1090ms + 777ms 长任务，越过 50ms 阈值一个数量级），50x（~1950 单）页面冻结不可用，100x（~3900 单）45s 内未完成（超时口径，不排除页面仍在缓慢推进——50x 切 tab 55,997ms 尚可完成）——订单量余量约 10 倍到可感知、50 倍到不可用。与原报告把它作为“独立优化任务”不排入 BOM 主线顺序不同，实测后提为首修（见 §6）。两点保留：① 本报告无业务订单增速数据，39→390 单的时间线未评估（仓库文档未提供增速），“现在修还是上量前修”需业务方补充判断；② 修复后的期望值只能给锚点、不能给承诺——修复后 50x 切 tab 的参考锚点为 1x/10x 档实测（353–360ms@40 单 / 1090ms@390 单），验收阈值建议见 §6。

建议按 orders、boms、stock 等依赖一次计算分配结果，建立 BOM 编码索引和订单号到可发量/状态的 Map，再供统计、筛选与行组件读取。仅缓存 `readyToShip` 的数组但每行仍线性 `find`，仍会保留二次查找。结果包含逾期字段，缓存还需考虑业务日期变化。

**收益边界（由实测成本推出；未实施修复，真实收益待实施后同法复测）。** 当前量级收益 ≤1.18ms/遍（三轮最大）；50x 档至少消除单遍 counts.ready ≈8.9–12s（外推区间），上界不超过该页 longTaskTotalMs 85,532 中订单派生计算的份额——该份额无法由本数据分解（长任务内计算/渲染/其它脚本的构成未拆，原始 trace 未对该窗口保存），不给百分比与修复后期望值。

### 实施与复测（2026-09-30 晚，P2 已实施）

**实施内容。** [views.ts](apps/frontend/src/data/views.ts) 新增 `deriveOrders`：一次全量分配产出可发量行表 + 订单号/BOM 编码双索引 Map；`readyToShip` 内部改用 BOM 索引（去掉每单 O(B) 线性查找）；`maxShipOf` 单遍化。[OrdersPage](apps/frontend/src/pages/orders/OrdersPage.tsx) 的 counts、任务/状态筛选、桌面行状态与移动卡片统一改读 `useMemo(() => deriveOrders(snap), [snap, today])` 的派生结果（today 进依赖处理逾期字段的跨天缓存边界）；[OrderTaskCard](apps/frontend/src/components/ui/MobileList.tsx) 增加可选 `derived` 属性。归档页/客户页/工作台搜索等单点调用未迁移，但经 `maxShipOf` 单遍化后单次调用提速约 8×（n=10000 单次 ~198ms→~20ms 量级）。验证：typecheck/lint 绿；前端测试 369/371 通过（SystemLogsPage 2 个失败为与本改动无关的既有日期敏感用例，经 stash 对照确认）。

**复测（同一基准、同数据规模，行为等价：ready 计数 331@10x / 1640@50x 与修复前一致）。**

| 指标 | 修复前（v1） | 修复后（v2，e2e-*-postp2） |
| --- | --- | --- |
| 10x（390 单）切「可发货」tab / longTaskMax | 1090ms / 777ms | **359ms / 135ms** |
| 50x（1950 单）冷加载 | 31,199ms | **1,984ms** |
| 50x 切「可发货」tab / longTaskMax / longTaskTotal | 55,997ms / 55,702ms / 85,532ms | **372ms / 160ms / 370ms** |
| micro 页面级派生（每次数据变化） | n400 ≈150–190ms、n2000 ≈5.5–12s（旧路径） | **n400 0.40ms、n2000 2.9ms、n10000 21.1ms**（p2-derived-once） |

50x 冻结完全消除；§6 验收参考阈值（修复后 50x 切 tab ≤1.2s、longTaskMaxMs ≤777ms）分别以 372ms / 160ms 远超达标。数据：out/perf-lab/v2/e2e-10x-postp2.json、e2e-50x-postp2.json、micro.json（post-P2 轮）。限制：本机受控环境复测，未覆盖生产网络与真实设备；收益数字为同栈前后对照。

## 4. 已有缓解措施与不能过度排除的部分

- [视口测量](apps/frontend/src/components/ui/DataTable.tsx#L178)使用 rAF 合并并跳过相同宽度更新；[表头/徽章测量](apps/frontend/src/components/ui/DataTable.tsx#L210)在 viewport、表头数量或密度变化时运行，写入状态有 same-check。这减少无效更新，但真实宽度变化仍会触发更新；[列宽拖动](apps/frontend/src/components/ui/DataTable.tsx#L414)的 pointermove 还会直接 setDraftPreferences，不能写成“DataTable 自身无高频 setState”。实测拖列宽 1x–100x 均 0–1 次慢帧，未见异常。
- 本次查看的 BOM、订单列表服务没有业务代码逐条循环发查询的写法。Prisma include 的实际 SQL 数量、扫描范围与耗时未采集，不作“所有后端均无 N+1”的全局结论。
- [nginx 配置](scripts/deploy/nginx.conf#L9)开启了 gzip 并包含 application/json；这是仓库配置事实，未现场核验生产响应。本报告 transferBytes 为自写反代未压缩 API 口径，生产实际传输字节会小于本报告数值，收益上界按未压缩口径陈述。压缩也不消除客户端解析、计算和渲染成本。
- [StockPage](apps/frontend/src/pages/stock/StockPage.tsx#L224)复用独立 BOM 缓存并查询库存聚合，可作为数据依赖拆分的参考；它仍有全量 BOM 数据及双份布局，不能当成已证明不存在性能问题的对照组。
- [StrictMode](apps/frontend/src/main.tsx#L19)可能使开发环境出现额外渲染/Effect 执行。实测均使用生产构建（apps/frontend/dist），已排除该干扰；不能据此推算开发版的固定倍数。

## 5. 已执行验证与实测记录

### 5.1 组件验证及其限制

2026-09-30 的上一轮复审中，使用项目现有 Vitest、React、TanStack Query 与 jsdom，以 mock API 控制加载顺序，完成七项临时实验；与现有三个测试文件合跑，共 **4 个文件、35 项测试全部通过**。临时文件已清理。本轮修订再次核对了这些结论涉及的源码。

| 临时实验                          | 条件与断言                                                                   | 结果                                          |
| --------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| 必需查询分批完成，随后 usage 完成 | 必需数据未齐时无 table；齐后先保存行及后代节点引用，usage 到达后比较对象身份 | 底色更新，原节点复用；关闭态 BomSpecs 未执行  |
| 悬停列宽手柄                      | 检查高亮变化、行对象身份、摘要函数调用次数                                   | 高亮更新，行保留，摘要调用未增加              |
| 已有数据的后台刷新                | 延迟返回相同 BOM 数据，比较刷新前后 table 对象                               | table 保留                                    |
| 大数据量下的当前页挂载            | 输入 1000 条 BOM，分别选每页 10、50 条                                       | 表格/卡片各 10、50 条；BomCell 总数为 20、100 |
| usage 未完成时切换“未使用”        | 比较切换前后的 table 对象并检查中途是否移出文档                              | 原表格卸载，完成后新建表格                    |
| 快照共享与独立缓存重复            | 同一 QueryClient 挂载两个相同快照 hook，再挂载 BOM 独立查询                  | 前两者共享；随后五类 API 各额外调用一次       |
| BomPicker 结果上量                | 直接传入 1000 条匹配记录                                                     | 创建 1000 个选项按钮                          |

这些实验验证的是所列条件下的结构和查询行为，不含真实耗时。耗时证据以下节实测记录为准。

现有三个测试文件可在仓库根重跑以下命令；**该命令不包含已清理的七项临时实验**：

```bash
pnpm --filter zmsysfrontend exec vitest run test/pages/bom/BomPage.test.tsx test/components/ui/DataTable.test.tsx test/data/queries.test.tsx
```

### 5.2 实测记录（2026-09-30，本机受控环境）

**数据来源（v1/v2 两轮，口径不同、引用时须区分）。** v2（2026-09-30 晚，修正采集缺陷后）：微基准 out/perf-lab/v2/micro.json；端到端 out/perf-lab/v2/e2e-1x.json（9 场景）、e2e-1x-layout-pair.json（P4 配对，dist-exp 实验构建）；原始 trace out/perf-lab/v2/traces/&lt;checkpoint&gt;-&lt;scenario&gt;.json.gz。v1（同日早，已归档 out/perf-lab/archive-v1/，含数据、脚本快照与缺陷清单 README）：e2e-1x/10x/50x/100x.json、micro.json——其中字节/请求计数、apiTimings、longtask、domNodes 与量级趋势不受 v2 修正影响，可继续引用；**键延迟（跨键错误归因）、layoutMs/paintMs/scriptMs（嵌套重复计数）、usage-filter 总耗时（20s 固定时序伪影）三类字段作废**。采集脚本 out/perf-lab/run-sweep.mjs、scenarios.mjs、metrics.mjs（当前即 v2 版）。正文未列入表格的明细（apiTimings 的字节/时延、notes 采样观察点）按 checkpoint + scenario 检索。

**环境与口径（v2 起）。**

- 单台本机、无并发用户；有头系统 Chrome（`C:\Program Files\Google\Chrome\Application\chrome.exe`），独立临时 profile；视口固定 1280×800。
- 前端为生产构建 `apps/frontend/dist`（断言无 vite dev client）；P4 配对实验用独立实验构建 `apps/frontend/dist-exp`（同一管线 + 单分支开关补丁，补丁已还原、diff 存档 archive-v1/bompage-single-layout.patch）；后端为编译产物 `apps/backend/dist/main.js`（`DB_DATABASE=zmdb_test` 覆盖 .env，非 watch）。
- 静态+API 反代为自写 node:http 服务（out/perf-lab/server.mjs）：静态文本按 Accept-Encoding 提供 gzip（对齐生产 nginx），API 响应原样透传（未压缩口径）。
- 认证 storageState 仅含 zm-token；业务 localStorage 每场景清空；每场景独立干净 context（配对场景自管多 context）；正式采样前完整预热一次；测量期间无其它并行负载。
- 指标口径：transferBytes = performance transferSize 之和（含响应头）；apiTimings = 按耗时降序前 8 个 /api 请求；longtask 阈值 50ms（浏览器标准，条目含 startTime）；domNodes = 稳定后 `document.querySelectorAll("*").length`；掉帧 = rAF 间隔 >25ms 计一次。apiVisibleCounts = 二次补数后经 API 核验的**接口可见记录数**（≠ 数据库表行数），unusedBoms 为实际分布（1x 档 20/60）。
- bom-search（v2）：Event Timing（durationThreshold=16；duration=输入→下一次绘制），每键以 event.timeStamp 与条目 startTime 绑定（容差 1.5ms）；未上报键不补零；结果变化按可见 BOM 编码序列+总数判定，无跨键猜测归因。
- bom-usage-filter（v2）：受控两遍（响应改写为空引用集），“受控 usage 等待段”为人为挂起、不代表真实网络耗时；“处理段”含响应解析/派生/调度/渲染与采集轮询步进（~250ms）。
- trace（v2）：CDP Tracing 原始事件 gzip 落盘，不做自动分桶汇总（v1 的按名称累加存在嵌套重复计数，相关字段作废）；关键时间窗用 DevTools/Perfetto 对原始 trace 定向检查。
- 量级梯度（seed，BOM/订单/客户）：1x = 60/40/20；10x = 400/390/200；50x = 2000/1950/1000；100x = 4000/3900/2000。生产量级参照 2026-09-29 生产备份（本地还原临时库），≈1x 档甚至略小。v2 仅重采 1x（1x 未复现卡顿级异常，按“先卡顿定位、容量验证按需”的原则未自动扩档；10x–100x 的规模趋势引用 v1 不受影响字段）。
- “可感知”判定以 50ms 长任务阈值与秒级等待为近似口径；micro 各档仅存中位数（p2/p5 两轮预热、其余 1 次试跑预热，各 9 计时轮）、未存 min/max 离散度；三轮对比显示 run-to-run 噪声可达 ±20ms 级且个别档跨阈值（见 §5.2 微基准表注），各档间小差异只按数量级解读。

**造数口径与密度交底（影响字节外推）。** 放大规则见 out/perf-lab/seed-topup.ts 头注释：主表（客户/BOM/订单/入库/出库/明细）补齐到生产行数 × F；目录型表（bom_category/material_group/material_item）次线性 ×√F，按品类整支克隆（10x+ 因此出现带“·性能N”后缀的克隆品类名）；BOM 明细 7–15 行、均值 10.8 对齐生产 shapes。由此每 BOM 字节跨档不恒定：早期 baseline 轨迹（seed 60/40/3）的 /boms 为 42,856B（≈714B/BOM；**该文件已在临时清理中删除、数值不可复核**，仅作当时观察记录），1x 为 76,960B（≈1,283B/BOM），10x+ 为 ≈1,691B/BOM（编码与品类名更长）。本文“≈1.7KB/BOM”“/boms 过 1MB 约在 ~620 个 BOM”的外推基于 10x–100x 造数密度；生产 40 BOM 未实测、生产编码/品类名长度未比对，外推对明细与名称密度敏感。baseline 与 1x 同为 60 BOM 却差近 2 倍的原因未回溯（测试库已多次重置）。

**生产量级基准（2026-09-29 备份，本地还原临时库）。**

| 表/口径 | 行数或均值 |
| --- | --- |
| bom_table / bom_item | 40 / 432（avg 10.8、max 15、min 7） |
| sales_order_table | 39 |
| inbound_ledger / outbound_ledger / outbound_shipment | 80 / 41 / 40 |
| custom_table（客户）/ material_item / material_group / bom_category | 20 / 263（被 BOM 引用在用 157）/ 85 / 9 |
| 单据行数口径 | 订单/入库/出库无子明细表（见 schema.prisma），按“单据展开到所引用 BOM 的 bom_item 物料行”计：订单 avg 10.9（max 15/min 8）、入库 avg 10.9、出库 avg 11.2（max 15/min 8）；出库另一口径每 shipment 的 ledger 行数 avg 1.03/max 2 |

1x 档 seed（60 BOM/40 订单/20 客户）略高于生产（40/39/20）。**造数链路（据 run-sweep.mjs / seed-data.mjs / seed-topup.ts 复核）**：采集前 `pnpm test:db:reset` 清空业务表，复跑链路为 seed-topup.ts --factor F（主表补齐到生产 ×F、目录 ×√F）+ run-sweep 内置 harness 幂等保底（seed-data.mjs 固定 TARGET_BOMS=60 / TARGET_ORDERS=40、客户下限 3，入库按“每 BOM 至少一条 + 每 4 单追加”）；两层叠加后**各档入库/出库流水实际条数未记录进轨迹**，生产 80 条入库与 1x 档的关系无法由轨迹反推（/api/inbound 15,957B@1x → 159,111B@10x 呈 ×10，仅可作规模参照），/api/inbound 生产载荷未按 80 条校准。baseline 轨迹（customers=3，文件已删、不可复核）据当时记录为纯 harness 路径，1x（customers=20）疑似叠加了 seed-topup ×1——与两者 /boms 密度差（714 vs 1,283B/BOM，baseline 数值同上不可复核）方向一致，未完全确证。微基准 n=40 档恰等于生产 BOM 数。

**端到端 v2（1x 档，e2e-1x.json + e2e-1x-layout-pair.json；seed 60 BOM/40 订单/20 客户/9 品类，unusedBoms=20）。**

| 场景 | 关键结果 |
| --- | --- |
| bom-cold-start | 到表格稳定 1261ms；longTaskMax 68ms；domNodes 726；trace 已落盘 |
| bom-cold-start-pair（usage 三接口延后 10s 交错配对 ×3） | normal [1185,1289,1297] 中位 1289ms（极差 112）vs delayed [1296,1282,1281] 中位 1282ms；差值 −7ms≈噪声——本机 localhost 栈下 usage 并发对首显无可测影响 |
| workbench-then-bom | 工作台冷载 1074ms → 导航 BOM 稳定 3246ms（v1 同场景 1935ms，跨轮波动大；无重复 HTTP 不变）；longTaskMax 175ms |
| consumer-then-bom（P3 真实路径，v2 新增） | 入库页 10 个 API → BOM 页 6 个；**五类资源（boms/bom-categories/orders/inbound/outbound）两阶段各取一次 = 重复获取坐实**；导航 1142ms；longTaskMax 85ms |
| bom-refresh-stale | 35s 过期重进 1229ms，4 请求（stocks + usage 三接口） |
| bom-search（Event Timing，v2） | 5/5 键上报：16/64/32/24/16ms（每键 duration，中位 32、max 64）；输入延迟与处理各 ≤0.4ms；2 键结果变、3 键窗口内无更新 |
| bom-usage-filter（受控两遍，v2） | pass A 非空：卸载断言✓、重挂✓、10 行；等待段 422ms、处理段 328ms（含轮询 ~250ms）、窗口长任务空。pass B 空：卸载断言✓、重挂✓、空态判定✓；436/313ms、窗口长任务空 |
| bom-column-resize | 2070ms 拖动、0 慢帧 |
| inbound-bom-picker | 打开弹窗 77ms；最大品类 11 项 |
| orders-page | 冷载 1096ms；切可发货 tab 360ms（ready 32）；longTaskMax 142ms |
| bom-layout-pair（P4 配对，dist-exp） | 冷挂载 dLoad 中位 1ms [17,6,1,-17,-6]（dual 极差 25ms，噪声级）；**pageSize50 更新 dUpdate50 中位 +46ms [46,48,46,30,48]（5/5 同号）**；DOM 差 +1206（5/5 一致） |

**端到端 v1（四档量级；字节/请求/longtask/domNodes 可用，键延迟与 usage-filter 总耗时字段作废）。**

**端到端 v1：BOM 页加载与跨页场景（字节为未压缩口径）。**

| 场景/指标 | 1x | 10x | 50x | 100x |
| --- | --- | --- | --- | --- |
| bom-cold-start：到表格稳定 | 1293ms | 1201ms | 1727ms | 2346ms |
| ├ 整页 transferBytes | 484,696B | 1,497,235B | 5,921,838B | 11,396,663B |
| ├ /api/boms（字节@时延） | 76,960B@23.7ms | 676,412B@125.4ms | 3,440,896B@507.1ms | 6,908,234B@940.4ms |
| ├ 最慢业务接口 | bom-categories 47.3ms | bom-categories 198.5ms | orders 737ms | orders 1408.2ms |
| └ domNodes | 726 | 742 | 772 | 796 |
| bom-refresh-stale（35s 过期重进）：到表格稳定 | 740ms | 1260ms | 1230ms | 1226ms |
| ├ 整页 transferBytes | 42,236B | 386,249B | 1,919,136B | 3,834,425B |
| └ 重进阶段重取（收尾快照口径） | stocks + usage 三接口（4 个） | 同左（4 个） | 同左（4 个；notes 计数矛盾见下注） | 同左（4 个；notes 计数矛盾见下注） |
| workbench-then-bom：工作台冷载 → 导航到 BOM 稳定 | 1093ms → 1935ms | 1183ms → 1926ms | 1602ms → 1955ms | 2375ms → 2436ms |
| ├ BOM 页六接口首取（各 ×1；工作台页仅 overview 聚合 + profile，无重复 HTTP，见 P3） | boms 51.2 / categories 68.4 / stocks 23.4 / orders 52.4 / inbound 32.6 / outbound 56.1ms | 145.1 / 192.5 / 55.8 / 187.7 / 82.4 / 171ms | 468.3 / 767.4 / 151.4 / 691.5 / 661.3 / 749.8ms | 929.4 / 1313.9 / 254.2 / 1353 / 1069.7 / 1187.5ms |
| └ longTaskMax | 165ms | 191ms | 379ms | 912ms |

注：bom-refresh-stale 四档行为一致，重进阶段均重取 stocks 与 usage 三接口（boms/bom-categories 未过期不重取）。50x/100x 轨迹 notes 的“orders×0 / outbound×0”与同场景 apiTimings 矛盾：notes 计数取自行数稳定时刻的快照，早于在途请求完成（50x 的 orders 410.8ms 尚在途）；apiTimings/apiRequestCount 取自 1.2s 后的收尾快照。已核验两档 apiRequestCount 均为 4，且 apiTimings 字节和（1,915,936 / 3,831,225B）与 transferBytes（1,919,136 / 3,834,425B，差额为文档与响应头等非 API 资源）吻合——以收尾快照为准，notes 的 ×0 计数不可信。

**端到端 v1：BOM 页交互与订单页场景（search 键延迟与 usage-filter 总耗时已作废，见 v2 口径）。**

| 场景/指标 | 1x | 10x | 50x | 100x |
| --- | --- | --- | --- | --- |
| ~~bom-search：键延迟 max / avg~~（作废：v1 跨键错误归因；v2 实测见上表 16–64ms） | ~~263 / 246.4ms~~ | ~~248.6 / 84.6ms~~ | ~~278.2 / 98.2ms~~ | ~~288 / 97.3ms~~ |
| ~~bom-usage-filter：切“未使用”到行数稳定~~（作废：3s 注入 + 20s 固定时序伪影；v2 受控两遍见上表） | ~~3057ms~~ | ~~20704ms~~ | ~~20709ms~~ | ~~20703ms~~ |
| └ tableRemounted（结构结论仍有效） | true | true | true | true |
| bom-column-resize：拖列宽全程 / 慢帧（>25ms） | 2051ms / 0 | 2063ms / 0 | 2053ms / 0 | 2056ms / 1 |
| inbound-bom-picker：打开弹窗到品类下拉可用 | 84ms | 84ms | 94ms | 94ms |
| ├ 最大品类项数（选项按钮；分布受 √F 造数影响，见 P5） | 11 | 19 | 50 | 78 |
| └ 选品类到选项渲染完成 | 251ms | 314ms | 352ms | 362ms |
| orders-page：冷加载到表格稳定 | 1142ms | 1409ms | 31,199ms | 45s 超时失败（ok=false） |
| ├ 切“可发货”tab 到行数稳定 | 353ms | 1090ms | 55,997ms | — |
| ├ ready 计数 | 32 | 331 | 1640 | — |
| └ longTaskMax / Total | 141 / 336ms | 777 / 1469ms | 55,702 / 85,532ms | — |

注：bom-usage-filter 的 3s 为注入延迟；10x/50x/100x 的 ~20.7s 由采集器固定时序主导而非页面耗时——这三档切“未使用”后最终仅 1 行且无带编码按钮的数据行出现（据 20s 等待未果推断为空态占位行），`waitForSelector("table tbody tr td:nth-child(2) button", { timeout: 20_000 }).catch(() => {})` 等满 20s 静默超时后才进入稳定轮询（out/perf-lab/scenarios.mjs），页面侧真实等待仍为 3s 注入 + 重挂（见 P7）。orders-page 100x 为 `page.waitForSelector` 45s 超时，无端到端数值。

**微基准曲线（各档 9 计时轮取中位数；单元格为 v2 早轮 / v2 晚轮 / v1 三轮值，来源文件：out/perf-lab/v2/micro-run2.json、micro-run3.json（实施前晚轮）、archive-v1/micro.json；当前 micro.json 为 P2 实施后复测轮，含新 target p2-derived-once，见 §3；p2/p5 两轮预热，其余目标 1 次试跑预热）。**

| 目标 | n=40 | n=400 | n=2000 | n=4000 | n=10000 |
| --- | --- | --- | --- | --- | --- |
| p2-ready-counts（全量 counts.ready 一遍，ms） | 1.018 / 1.182 / 1.026 | 167.032 / 190.153 / 158.906 | 8,915.663† / 11,951.285† / 8,529.786† | 57,410.556† / 78,387.369† / 56,914.971† | 1,096,090.416† / 1,635,948.323† / 1,096,901.926† |
| p5-search-filter（关键词空→非空的整页 update，ms） | 5.492 / 7.219 / 5.871 | 6.058 / 8.267 / 6.648 | 10.56 / 18.375 / 27.018 | 21.661 / 19.192 / 16.407 | 30.907 / 54.11 / 32.01 |
| p6-page-summary pageSize=10（当前页 10 个 BomCell 挂载，ms） | 2.787 / 1.406 / 2.835 | 2.917 / 1.387 / 1.263 | 1.262 / 3.149 / 1.253 | 1.181 / 3.023 / 1.214 | 1.164 / 1.393 / 1.243 |
| p6-page-summary pageSize=50（ms；池 40 档实际挂 40 个） | 10.902 / 5.643 / 11.595 | 14.602 / 16.564 / 6.446 | 5.81 / 16.037 / 5.954 | 5.88 / 6.538 / 6.024 | 5.932 / 6.589 / 5.997 |
| p6-page-update pageSize=10（usage 到达父级 update 整页，ms，v2 新增） | 16.323 / 17.111 | 2.896 / 3.17 | 3.044 / 20.428 | 3.567 / 3.79 | 21.746 / 22.366 |
| p6-page-update pageSize=50（ms，v2 新增） | 8.248 / 9.394 | 10.289 / 11.415 | 10.077 / 11.817 | 10.883 / 11.939 | 12.366 / 14.016 |
| picker-mount（BomPicker 全匹配项挂载，ms） | 2.671 / 3.125 / 2.725 | 33.176 / 47.741 / 51.904 | 164.413 / 171.422 / 149.442 | 282.872 / 483.704 / 297.884 | 848.466 / 928.359 / 863.9 |

† n≥2000 三档为外推预估（试跑 8 次真实调用均值 × 活跃单数），不是实测中位数；p2 的 n=40/400 为实测中位数。**三轮对比显示 run-to-run 噪声显著（±20ms 级，个别档跨阈值）**：p5 n=10000 为 30.9/54.1/32.0（晚轮跨过 50ms——搜索计算在 10000 BOM 档处于阈值噪声区，不足以定拐点）；picker n=400 为 33.2/47.7/51.9（跨阈值区间，确定性超阈值从 2000 项起）；p6-page-summary 的池 40/400 与 ≥2000 档差异三轮不单调（如 ps10 池400 = 1.263/2.917/1.387），**池间差异应视为噪声主导、不作归因**；p6-page-update n=2000 pageSize10 的晚轮 20.4ms 为离群（早轮 3.0ms），n=10000 pageSize10 两轮均 ~22ms 的抬升是可复现的（O(池规模) 筛选重走分量，见 P6）。v2 早轮 micro.json 被晚轮覆盖，数值自当日会话回显誊录恢复（micro-run2.json 的 provenance 字段与 notes 说明来源，p6-page-update 另存 stdout 片段佐证）。

**复跑命令（仓库根）。**

```bash
# 微基准（写 out/perf-lab/v2/micro.json）
pnpm --filter zmsysfrontend exec vitest bench test/perf/ --run
# 造数（量级梯度；品类固定 9 的选择器定向档加 --catalog-fixed）
pnpm exec tsx out/perf-lab/seed-topup.ts --factor F [--catalog-fixed]
# 端到端采集（PERF_LAB_ONLY=场景id,... 可只跑指定场景）
node out/perf-lab/run-sweep.mjs --checkpoint <label> --out out/perf-lab/v2/e2e-<label>.json
# P4 单/双分支配对（先构建实验包：应用 archive-v1/bompage-single-layout.patch 后执行
#   pnpm --filter zmsysfrontend exec vite build --mode production --outDir dist-exp --emptyOutDir，构建完成即还原补丁）
PERF_LAB_LAYOUT_EXP=1 PERF_LAB_ONLY=bom-layout-pair node out/perf-lab/run-sweep.mjs \
  --checkpoint 1x-layout-pair --dist apps/frontend/dist-exp --out out/perf-lab/v2/e2e-1x-layout-pair.json
# 重置测试库
pnpm test:db:reset
```

**复现性提示（2026-09-30 收尾更新）。** apps/frontend/test/perf/（微基准）已入库；out/perf-lab/ 工作区（采集脚本与全部轨迹 JSON，含 v1 归档、v2 数据与 P2 复测数据）已按清理要求从工作树移除——全部内容保留在 git 历史中（d885ec1 引入、P2 提交补齐 post-P2 数据、后续 chore 提交移除），需要复跑时先 `git checkout <P2提交> -- out/perf-lab/` 恢复（微基准运行时会自动重建 out/perf-lab/v2/ 输出目录）。

**未覆盖与局限（不得写成已排除）。**

- **用户实际遇到的“BOM 加载卡顿”未在本机复现**（1x 档最慢为工作台→BOM 导航 3.2s、各场景 longTaskMax 63–175ms），其发生条件（操作路径、数据状态、网络、设备）未定位——需实际使用路径与设备取证：在真实环境记录卡顿发生时的操作序列、Network/Performance 面板或 trace，再对号入座；本机继续扩量级不能回答该问题。
- 全部测量来自单台本机有头 Chrome + 本地自写反代、无并发用户；未覆盖生产网络 RTT、真实客户端硬件与多用户下的服务器负载。usage 并发对首显“无可测影响”的结论仅在本机 localhost 栈下成立；P7“usage 滞后窗口”在生产慢网下的实际大小无法由本数据回答。
- 移动端视口未覆盖（全部为 1280×800 桌面视口）；P4 的双份布局在移动分支真实视口下的表现未实测，pageSize10（默认档）的单/双分支差值未单独测（按 pageSize50 实测 46ms 与行数比例推约 ~9ms，未验证）。
- e2e 字节为未压缩 API 口径；生产 nginx gzip 的实际效果未现场核验。
- 生产 40 BOM 量级的 /boms 响应未单独实测（微基准 n=40 恰等于生产 BOM 数）；入库 80 条流水的 /api/inbound 载荷未单独校准；生产编码/品类名长度与造数密度的偏差未比对（影响字节线性外推）。
- 业务增速无数据：订单（39→390/1950）、入库/出库流水、BOM/目录/品类的增长时间线均未评估（需业务方提供），影响 P1（资源拐点 ≈15x）、P2（拐点 ≈10x 订单）、P3（≈50x 起接近秒级）、P5 选择器（品类数不增长假设下 ~445 项@4000 BOM 接近阈值）的立项时点；P3 的高频导航路径（哪些 useWbSnapshot 消费页常被走向 BOM 页）未评估。
- 1x 档除 refresh-stale 外各场景 63–175ms 的 longTaskMax 未归因（是否属首载渲染/脚本成本未验证）；v2 已落盘原始 trace（out/perf-lab/v2/traces/），尚未做逐窗检查——归因不完整的场景不得声称已排除。
- Event Timing 不保证每键都上报（durationThreshold=16 之下仍可能不报）；v2 1x 档 5/5 键上报属运气好的样本，键数更多时未上报键按“未上报”记录、不补零。
- 选择器“品类固定 9”的定向造数档（--catalog-fixed）工具已备未跑；p6-page-update 的 n=10000 pageSize10 档 21.7ms 中 O(池规模) 筛选份额未单独拆分。
- micro.json 未存各档 min/max 离散度，run-to-run 噪声幅度无法精确量化（三轮对比显示可达 ±20ms 级、个别档跨阈值）；p2-ready-counts n≥2000 为外推；e2e-100x orders-page 失败无端到端数值。
- “可感知”以 50ms 长任务阈值与秒级等待为近似口径，未经真实用户感知研究验证。

## 6. 实施顺序与验收建议（P2 已实施并通过验收，其余待实施）

实测后按“拐点先后 × 实测收益上界”重排为 P2 → P1 → P3 → P7 → P5 → P4 → P6。与原顺序（阶段 1 P1；阶段 2 P4+P7；阶段 3 P3+P5+P6；P2 独立不排入）的差异及数据依据：

| 顺序 | 工作                                 | 实测依据与差异说明                                                                                       | 验收重点                                                                                     |
| ---- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1    | **P2** 订单派生一次计算分配（**已实施，2026-09-30**） | **由“独立任务”提为首修**：拐点最早最陡——10x 切 tab 1090ms + 777ms 长任务、50x 冻结 55.7s、100x 45s 内未完成（超时口径）；当前 ≈1.0–1.2ms/遍（三轮）无感，属上量前加固（修复时点需订单增速评估，本报告无该数据，见 §3）。**实施后已按同基准复测验收：50x 切 tab 372ms（阈值 ≤1.2s ✓）、longTaskMaxMs 160ms（最低要求 ≤777ms ✓）、ready 计数与修复前一致（行为等价），50x 冻结消除，明细见 §3“实施与复测”** | 统计、筛选、行组件读同一分配结果；订单/入库/出库数据边界与逾期字段正确；50x 档同法复测切 tab 与 longTaskMaxMs——**已达成**（e2e-50x-postp2：372ms/160ms） |
| 2    | **P1** 使用关系轻量聚合接口          | 维持原阶段 1 位置：字节线性（≈1.7KB/BOM，/boms 过 1MB ≈15x）；当前冷启动 1293ms 无感；立项时点可参考资源拐点 ≈15x，需 BOM/目录增速评估（本报告无该数据） | BOM 使用状态不再依赖这三个完整列表；作废、归档、软删除、库存调整、加载失败和权限边界保持正确；实施后同法复测六接口字节与刷新路径 |
| 3    | **P3** 资源级缓存                    | **由原阶段 3（P4 之后）提前**：重复路径已在真实导航中实测坐实（入库页→BOM 五类资源各重取，v2 consumer-then-bom；工作台页走 overview 聚合、无重复）；BOM 缓存为空时六接口载荷为重复上界（100x 五类 10,995,745B、可省门控等待至 1.31s，50x 起接近秒级口径）；立项时点依赖订单/流水增速与高频导航路径评估（本报告无该数据） | 新鲜缓存或在途同资源请求正确复用；写操作和手动刷新均更新相关结果；与 P1 聚合接口同步设计 key；实施后以 consumer-then-bom 场景复测重复获取清零 |
| 4    | **P7** 等待 usage 时表格框架稳定     | **由原阶段 2 降级为轻量 UX 修复**：受控两遍（非空/空）断言卸载/重挂复现，窗口内无 >50ms 长任务、重挂渲染 16–17ms（池 40，pageSize10，两轮），但“切筛选后表格消失/0 行闪烁”是正确性问题且修复廉价 | 筛选等待状态清楚；不把未知引用当作“未使用”或放行删除；卸载窗口消除（以 v2 受控两遍场景复测断言通过为验收） |
| 5    | **P5** 搜索索引与选择器收敛          | 大体维持原阶段 3/4 位置：当前每键交互 16–64ms（Event Timing，计算份额 ≤6ms）、选择器挂载 2.7ms/40 项；品类数不增长的业务假设下选择器是 BOM 侧最早接近阈值的项（~445 项@4000 BOM 对应 ~35–55ms） | 相同数据的交互减少重复计算；所有选项可到达；已选项不丢失 |
| 6    | **P4** 单份响应式布局                | **由原阶段 2 压到末段，但理由更新**：配对实测 pageSize50 更新路径稳定 +46ms（5/5 同号）+ 1206 DOM 节点——真实但量级小于阈值；冷挂载未检出稳定差异；默认 pageSize10 档对应值未测 | 每次仅挂载当前布局；跨断点、弹窗、焦点和分页正常；实施后以 bom-layout-pair 场景复测差值归零 |
| 7    | **P6** 行计算缓存                    | **维持最末**：更新期成本已实测（当前量级上界 16.3–17.1ms@pageSize10 池 40；池 ≥400 档 2.9–3.8ms），触发源已定位（unusedCodes 等筛选依赖变化） | 缓存失效边界与业务日期变化正确；池 10000 档的 O(池规模) 筛选重走若要消除，与 P5 预计算同机制实施 |

原“阶段 0 取得基线”已由本轮实测记录（§5.2）代替。BOM 列表的服务端分页会影响现有全量缓存消费者，必须明确列表、选择器和工作台所需的数据契约；不能直接给现有接口加 limit 后继续做全局计算。主表虚拟化是否值得引入，应在单份布局、当前页规模和行复杂度确定后再判断。

优化前后应使用相同数据、构建模式、设备和操作流程，重复采样，比较请求数/传输体积、交互延迟、主线程长任务、挂载与 DOM 增删（复跑命令见 §5.2）。**以上各项均未实施修复，本文全部收益为实测成本推出的上下界，真实收益待实施后同法复测。**

**下一步：实际使用路径与设备取证（当前最优先；P2 已实施，其余 P 项按上表顺序待实施）。** 本机受控环境在 1x 档未复现“BOM 加载卡顿”（最慢交互 3.2s、longTaskMax ≤175ms、各已测成本均低于可感知口径），继续在本机扩量级不能回答“用户为什么觉得卡”。生产 op_log（2026-09-16→09-29，177 条写操作，分析结论见桌面《bom-卡顿取证指引.md》）显示高频写路径为建单/发货/入库/批量归档（3 人小团队、工作时段活跃，曾出现 3 分钟 21 连发归档）——这些操作触发快照失效与订单/入库页重渲染，P2 已消除其派形成本；但纯浏览/搜索/筛选不入日志，卡顿若发生在只读交互仍需现场采集。取证步骤（复现时 5 分钟）：① 请实际使用者在卡顿时录 Chrome DevTools Performance（保存 .json）并记录操作路径；② Network 面板截图（总请求/传输/Load）；③ 材料交付后用 v2 采集链路对照分析（详细指引见桌面《bom-卡顿取证指引.md》；采集链路恢复方式见“复现性提示”）。
