# BOM 加载与表格交互性能审计报告

- 复审日期：2026-09-30；源码基线：当前工作区，HEAD `fbe40ed`。本文行号只对应本次复审的实现。
- 目标：减少 BOM 页面及相关选择器的不必要数据加载、主线程计算和 DOM 挂载，改善首载、搜索、刷新与表格交互。
- 状态：**审计与优化建议，尚未实施这些优化。** 已核对源码并完成受控组件验证；尚未采集生产构建的性能轨迹，不能宣布卡顿主因或优化收益。
- 证据分为“源码事实”“组件验证”“待性能实测”。下文 P1–P7 是问题编号，保留旧报告编号供追踪，不代表严重等级或实际耗时排序。P2 属于订单页，单独列出。

## 1. 结论与归因边界

已确认的问题是：BOM 使用关系依赖三个全量业务列表；工作台快照与 BOM 独立查询重复获取资源；主表同时挂载桌面和移动两套当前页内容；搜索和部分行展示存在重复计算；使用筛选在特定加载阶段会卸载表格。入库弹窗中的 BomPicker 还存在结果全量挂载问题。

**不能把“多个 HTTP 请求”“React 重渲染”“重新创建整张表格 DOM”当作同一件事。** 创建新的 React element、调用 `cloneElement` 或执行组件函数，不等于替换已有 DOM。同位置、同类型且 key 稳定的节点通常可以复用；是否真正卸载应观察组件生命周期或 DOM 节点身份。参见 [React：Render and Commit](https://react.dev/learn/render-and-commit)。

| 层面             | 本次确认的风险                                     | 不能由此直接推出的结论                                   |
| ---------------- | -------------------------------------------------- | -------------------------------------------------------- |
| 数据传输         | 全量明细、跨缓存重复请求，规模随业务数据增长       | 每个响应都会重新挂载一次表格                             |
| 主线程计算       | 非空搜索重建检索文本；父页面更新可能重复计算行摘要 | 每次局部 state 变化都会重算全页；DOM 必定重建            |
| DOM 挂载         | 两套当前页内容；选择器全量结果；加载分支替换表格   | BOM 主表没有数量约束；隐藏内容的布局绘制成本等于可见内容 |
| 浏览器布局与绘制 | 列宽变化、表头测量、属性更新需要继续采样           | 已被 same-check 或 rAF 完全消除                          |

### BOM 页面加载到渲染的实际链路

源码：[查询入口与加载门控](apps/frontend/src/pages/bom/BomPage.tsx#L815)、[usage 的 Promise.all](apps/frontend/src/data/queries.ts#L101)、[表格条件渲染](apps/frontend/src/pages/bom/BomPage.tsx#L1043)。

| 场景                                           | 当前行为                                                              | DOM 判断                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| 冷启动，默认“全部状态”，请求正常成功           | boms、categories、stocks 三个必需查询加载期间显示占位；usage 同时请求 | 必需查询未齐时没有 DataTable，不能按请求数推算表格挂载次数 |
| usage 在表格出现后完成，仍为“全部状态”         | 更新引用集合和行底色；`unusedCodes` 变化还会使筛选 memo 失效          | 组件验证中，原表格、行及行内节点均复用                     |
| 已有数据时后台刷新，响应内容相同               | 走 `isFetching && !isLoading` 的延迟遮罩                              | 组件验证中原表格保留；实际行数据增删仍可造成局部 DOM 增删  |
| usage 初次请求未完成时切到“未使用”或“正在使用” | usage 加入 `isLoading` 条件，表格改为占位，完成后显示筛选结果         | 会卸载并重新挂载 DataTable，见 P7                          |
| 翻页或筛选改变当前行集合                       | 按新的 `pageRows` 输出行                                              | 部分行增删属于正常行为，不能与整表卸载混为一谈             |

## 2. BOM 主线问题

### P1：使用关系依赖三个全量列表；BOM 本身也全量携带明细

**源码事实。** 缓存为空、请求成功且不计重试、公共布局请求和用户操作时，BomPage 的四个查询会发起六个 GET：`/boms`、`/bom-categories`、`/bom-stocks`、`/orders`、`/inbound`、`/outbound`。`useBomUsage` 将后三个请求放在同一个 `Promise.all` 中，全部完成后才返回 usage 数据，不是三个独立的成功数据提交。

- [BOM 列表](apps/backend/src/boms/boms.service.ts#L118)：没有分页，包含每个 BOM 的全部 `items`。
- [订单列表](apps/backend/src/orders/orders.service.ts#L49)、[入库列表](apps/backend/src/inbound/inbound.service.ts#L52)、[出库列表](apps/backend/src/outbound/outbound.service.ts#L64)：没有分页，均排除 `deletedAt != null` 的行；返回数据仍包括未软删除的归档订单或作废单据。
- [品类目录](apps/backend/src/boms/boms.service.ts#L93)包括目录物料，规模随目录增长；[库存映射](apps/backend/src/boms/boms.service.ts#L131)按 BOM 聚合，返回规模随有流水的 BOM 数量增长。它们比完整业务流水紧凑，但不能表述成“固定大小、永不增长”，也不能据返回体小断言后端聚合成本小。
- [缓存配置](apps/frontend/src/main.tsx#L11)为全局 `staleTime: 30_000`、`retry: 1`、关闭窗口聚焦刷新；[BOM 和品类](apps/frontend/src/data/queries.ts#L59)的 staleTime 为五分钟。因此不是每次进入页面都固定发六个请求；缓存状态、主动失效和重试会改变实际请求数。

**保留功能的约束。** [引用集合与删除入口](apps/frontend/src/pages/bom/BomPage.tsx#L851)同时服务于使用筛选、未使用行底色和删除入口判断。仅在用户选择“未使用”时启用 usage，会让默认列表缺少这部分依据。默认“全部状态”不把 usage 在途状态计入页面加载遮罩，但一次底色更新本身不能证明发生了卡顿。

**建议，尚未实施。** 提供 BOM 使用关系的轻量聚合接口，替代三个完整列表。可按 BOM 返回状态或去重后的编码集合；具体 SQL、索引与执行计划另行验证，不预设“一条 distinct 查询”就一定高效。接口必须明确以下不同规则：

| 含义             | 当前依据                                                   | 聚合时应保持的边界                                           |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| 列表“正在使用”   | 未软删除的订单、入库、出库记录中出现该 BOM                 | 归档/作废不自动排除；库存调整不计入这个筛选                  |
| 前端显示删除入口 | 有删除权限，引用与库存数据已返回，无上述引用且库存为零     | 只是入口预判，未知状态不能当作无引用                         |
| 后端允许物理删除 | 删除事务检查仍存在的订单、入库、库存调整记录，另有外键约束 | 包括保留期内尚未物理清理的软删除记录；“未使用”不等于“可删除” |

依据：[后端删除校验](apps/backend/src/boms/boms.service.ts#L379)、[业务权限与删除规则](docs/business/roles.md)。若聚合接口提供删除阻断信息，应与后端规则对齐，最终删除仍由事务重新校验。新增接口的权限及契约需同步核对 [roles.md](docs/business/roles.md)、[db-scheme.md](docs/db-scheme.md) 和 [openapi.yaml](docs/openapi.yaml)。

### P3：跨工作台与 BOM 查询重复获取五类资源

**源码事实与组件验证。** [工作台快照](apps/frontend/src/data/queries.ts#L117)直接调用各 API 函数，结果存在 `["wb", { includeCustomers, includeUsers }]` 下；BOM 列表、品类使用各自的 [bomKeys](apps/frontend/src/data/queries.ts#L51)，usage 使用 `["wb", "bom-usage"]`。直接调用同一个 API 函数不会自动复用另一个查询的缓存。

因此在工作台快照已取得数据、BOM 独立缓存仍为空时，进入 BOM 页会再次获取 **BOM、品类、订单、入库、出库** 五类资源。组件实验确认了这一行为，即使工作台缓存仍新鲜也会发生。工作台自身按权限发起六至九个请求，不宜固定写成八至九个。

**需要排除的误判。** 同一 QueryClient 内、相同权限参数下，多个 `useWbSnapshot` 消费者使用相同 key；实验中两个同时挂载的消费者共享请求。页面和弹窗都调用该 hook，不构成额外缓存割裂的证据。数据过期、主动失效等正常刷新另计。

**建议，尚未实施。**

- 优先用 P1 的聚合接口移除 BOM 页对三类完整业务明细的依赖；不要为了“共享”又让 BOM 页依赖完整工作台快照。
- 对确实需要共享的 BOM、品类等资源，定义统一的资源级 queryKey、queryFn 和缓存策略，快照从这些资源组合数据。相同 key 必须对应相同数据契约；不能把当前 Snapshot 与 usage 的不同返回结构直接改成同一个 key。
- 同时更新 [刷新与 mutation 失效规则](apps/frontend/src/data/queries.ts#L178)，覆盖聚合数据、资源缓存及组合结果。仅让快照调用 `fetchQuery`、却继续只失效旧快照 key，可能读到仍被判为新鲜的旧资源。

### P4：桌面与移动双份挂载，但主表行数已受分页限制

**源码事实与组件验证。** [pageRows](apps/frontend/src/pages/bom/BomPage.tsx#L914)先切片，再分别用于 [移动卡片](apps/frontend/src/pages/bom/BomPage.tsx#L1003)和 [桌面表格](apps/frontend/src/pages/bom/BomPage.tsx#L1043)。[CSS](apps/frontend/src/index.css#L675)仅隐藏当前视口不使用的分支，不会阻止 React 挂载它。

[分页选项](apps/frontend/src/components/ui/Pagination.tsx#L34)为 10、30、50。实验输入 1000 个 BOM 时，默认挂载 10 行表格和 10 张卡片；切换每页 50 条后为 50 行和 50 张卡片，共 100 个 BomCell 实例。**100 是行内容实例数量，不是总 DOM 节点数量；两种布局的子树结构也不相同。**

冗余成本包括隐藏分支的组件执行、节点创建与内存；不能直接推导布局绘制工作翻倍。也没有依据断言默认十条“必然无感”。

**建议，尚未实施。** 按与现有 CSS 一致的 1024px 断点只挂载一种布局，数据查询、分页、筛选和业务弹窗状态放在稳定的共同父层。复核缩放跨断点、焦点和弹窗交互。主表是否还需要虚拟化由当前页渲染耗时决定；已有分页时，缺少虚拟化本身不等于 DOM 无上界。

### P5：非空搜索重复生成检索文本；入库选择器全量挂载匹配结果

**BOM 主表搜索。** [filtered 的 useMemo](apps/frontend/src/pages/bom/BomPage.tsx#L889)依赖 `boms、keyword、category、statusFilter、unusedCodes`。它不是每次页面渲染都重算；翻页、开弹窗并不会在这些依赖保持不变时触发筛选计算。

[输入框](apps/frontend/src/pages/bom/BomPage.tsx#L944)直接更新 keyword，没有防抖。关键词非空时，对通过前置品类/使用状态筛选的候选 BOM，重新拼接编码、品类、规格和物料文本并转小写；关键词为空时由 `!kw` 短路，不会执行这段拼接。候选规模大、明细长时是计算风险，实际耗时待采样。

**BomPicker。** [搜索与列表渲染](apps/frontend/src/components/bom/BomPicker.tsx#L17)对所有匹配项执行 `map`，`max-h-60` 只是滚动容器高度，不减少 DOM。实验输入 1000 条匹配 BOM 时，创建 1000 个选项按钮。当前调用方是 [入库页的新建/编辑选择器](apps/frontend/src/pages/inbound/InboundPage.tsx#L57)，先按品类收敛；它不在 BomPage 的默认列表渲染链上。

**建议，尚未实施。** 按 BOM 数据变化预生成检索文本，必要时增加约 150–250ms 防抖或延后结果更新，并验证输入响应。预计算仍占内存，数据很大时应评估服务端搜索。选择器采用分页、可继续加载或虚拟化，保证所有匹配项仍可到达、已选项不会丢失；不可只做 `slice(0, N)` 静默隐藏剩余选项。

### P6：行展示与 DataTable 有重复工作，但不是“整表 DOM 重建链”

**源码事实。** [BomCell](apps/frontend/src/components/bom/BomCell.tsx#L9)未使用 `React.memo`，组件执行时会调用 `bomComposition` 与 `bomSummary`。[组合品类分解](apps/frontend/src/data/bomComposition.ts#L12)对组合品类构建目录 Set/Map，非组合品类在第 15 行早退。父页面更新并重新生成行 JSX 时，当前页的两套行内容可能重复执行这些计算。

[DataTable](apps/frontend/src/components/ui/DataTable.tsx#L126)每次 TableView 渲染重新解析 children，随后 [遍历行与单元格并 cloneElement](apps/frontend/src/components/ui/DataTable.tsx#L464)。这会分配 React element、计算样式和执行协调，但当前 BOM 行 key 为稳定的 `bom.code`，单元格 key 为列标识，不能据此认定 DOM 被替换。

**组件验证与范围。** 悬停列宽手柄会更新 TableView 的 `activeColumn` 和列高亮，但实验中未重新调用 BomCell 的摘要函数，行 DOM 保留。该局部 state 更新不向上触发 BomPage；原单元格子元素也可以被复用。因此“悬停会重算全页搜索、订单状态和全部行摘要”不成立。

[BOM 行里的 BomSpecs](apps/frontend/src/components/bom/BomCell.tsx#L66)位于 Modal 内；[Modal 关闭时 return null](apps/frontend/src/components/ui/Modal.tsx#L112)，实验中未执行 BomSpecs。给它加 memo 不能减少这个关闭态列表的物料 DOM，因为这些 DOM 本来就不存在。

**建议，尚未实施。** 先定位重复计算的实际触发源，再对稳定 props 的 BomCell、目录索引和摘要做有针对性的缓存。若 TableView 协调或高亮更新在性能轨迹中显著，再拆分表体与交互状态、稳定行 props，或调整高亮实现。仅给接收全新 JSX children 的外层表格套 memo，不保证能跳过工作；memo 也不会减少首次挂载数量。

### P7：usage 未就绪时启用使用筛选，会卸载并重新挂载表格

**源码事实与组件验证。** [usageFilterActive 与 isLoading](apps/frontend/src/pages/bom/BomPage.tsx#L825)结合 [桌面条件分支](apps/frontend/src/pages/bom/BomPage.tsx#L1043)，形成可复现链路：

1. boms、categories、stocks 已成功，usage 仍在初次加载；默认“全部状态”的表格已显示。
2. 用户切到“未使用”（“正在使用”同一门控）。
3. `isLoading` 变为 true，DataTable 被 PageLoading 替换；移动列表也显示占位。
4. usage 完成后重新挂载表格并应用筛选。实验确认新旧 table 不是同一个 DOM 对象。

这是真实的重复挂载路径，但不代表正常 usage 返回或每次后台刷新都走此路径。

**建议，尚未实施。** 保持表格框架稳定，将“首次数据加载”“正在取得使用状态”“后台刷新”分别处理。可暂缓应用筛选并明确标注旧结果，或在状态未知时暂时禁用相关筛选；不能将旧结果冒充新筛选结果，也不能把未加载/失败的引用数据当作“未使用”或允许删除。

## 3. P2：订单页存在重复全量派生，作为独立优化任务

源码：[OrdersPage 的统计与筛选](apps/frontend/src/pages/orders/OrdersPage.tsx#L711)、[data/views.ts 的派生函数](apps/frontend/src/data/views.ts#L48)。

`counts.ready` 为每个活跃订单调用 `maxShipOf`，而 `maxShipOf` 每次完整执行 `readyToShip`，其中包括订单过滤、排序、BOM 线性查找，再用 `find` 定位订单。最坏情况下存在二次级重复计算并叠加排序、BOM 查找因子。ready 筛选、状态筛选、[桌面行状态](apps/frontend/src/pages/orders/OrdersPage.tsx#L1263)以及 [移动订单卡片](apps/frontend/src/components/ui/MobileList.tsx#L88)还会继续调用相关函数。

建议按 orders、boms、stock 等依赖一次计算分配结果，建立 BOM 编码索引和订单号到可发量/状态的 Map，再供统计、筛选与行组件读取。仅缓存 `readyToShip` 的数组但每行仍线性 `find`，仍会保留二次查找。结果包含逾期字段，缓存还需考虑业务日期变化。

这项问题并非 BomPage 渲染期正在执行的计算；不能把它排为 BOM 首载卡顿的已证实原因，也不能在没有同环境测量时断言它一定更早恶化。

## 4. 已有缓解措施与不能过度排除的部分

- [视口测量](apps/frontend/src/components/ui/DataTable.tsx#L178)使用 rAF 合并并跳过相同宽度更新；[表头/徽章测量](apps/frontend/src/components/ui/DataTable.tsx#L210)在 viewport、表头数量或密度变化时运行，写入状态有 same-check。这减少无效更新，但真实宽度变化仍会触发更新；[列宽拖动](apps/frontend/src/components/ui/DataTable.tsx#L414)的 pointermove 还会直接 setDraftPreferences，不能写成“DataTable 自身无高频 setState”。
- 本次查看的 BOM、订单列表服务没有业务代码逐条循环发查询的写法。Prisma include 的实际 SQL 数量、扫描范围与耗时未采集，不作“所有后端均无 N+1”的全局结论。
- [nginx 配置](scripts/deploy/nginx.conf#L9)开启了 gzip 并包含 application/json；这是仓库配置事实，未现场核验生产响应。压缩也不消除客户端解析、计算和渲染成本。
- [StockPage](apps/frontend/src/pages/stock/StockPage.tsx#L224)复用独立 BOM 缓存并查询库存聚合，可作为数据依赖拆分的参考；它仍有全量 BOM 数据及双份布局，不能当成已证明不存在性能问题的对照组。
- [StrictMode](apps/frontend/src/main.tsx#L19)可能使开发环境出现额外渲染/Effect 执行。不能据此推算固定请求倍数或声称开发版必然慢几倍，性能基线应使用生产构建。

## 5. 已执行验证及其限制

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

这些实验验证的是所列条件下的结构和查询行为。它们没有真实网络、数据库和浏览器布局绘制，不能作为卡顿耗时、生产 DOM 总数或性能提升幅度的证据。

现有三个测试文件可在仓库根重跑以下命令；**该命令不包含已清理的七项临时实验**：

```bash
pnpm --filter zmsysfrontend exec vitest run test/pages/bom/BomPage.test.tsx test/components/ui/DataTable.test.tsx test/data/queries.test.tsx
```

## 6. 实施顺序与验收建议（均待实施）

建议按依赖关系推进，不把以下顺序当作已测得的耗时排名：

| 阶段                  | 工作                                                                                                   | 验收重点                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 0. 取得基线           | 生产构建、固定设备/数据/视口，分别记录冷启动、工作台切 BOM、刷新、搜索、使用筛选、列宽交互、入库选 BOM | 区分请求等待、响应大小、JS 计算、布局绘制；同时记录 React 更新与真实挂载，区分冷/热缓存      |
| 1. 减少使用关系数据   | P1：以轻量聚合替代订单/入库/出库全量请求                                                               | BOM 使用状态不再依赖这三个完整列表；作废、归档、软删除、库存调整、加载失败和权限边界保持正确 |
| 2. 减少冗余挂载       | P4 单份响应式布局；P7 避免等待使用状态时替换整表                                                       | 每次仅挂载当前布局；筛选等待状态清楚；跨断点、弹窗、焦点和分页正常                           |
| 3. 减少重复获取与计算 | P3 资源级缓存；P5 搜索索引；按实测选择 P6 的行计算缓存                                                 | 新鲜缓存或在途同资源请求正确复用；写操作和手动刷新均更新相关结果；相同数据的交互减少重复计算 |
| 4. 按规模继续收敛     | 选择器分页/虚拟化；评估 BOM 服务端搜索、分页和按需详情                                                 | 所有选项可到达；筛选/排序/总数口径正确；明细按需取得；不能将局部数据用于全局库存或订单分配   |

BOM 列表的服务端分页会影响现有全量缓存消费者，必须明确列表、选择器和工作台所需的数据契约；不能直接给现有接口加 limit 后继续做全局计算。主表虚拟化是否值得引入，应在单份布局、当前页规模和行复杂度确定后再判断。P2 的订单派生优化单独验收。

优化前后应使用相同数据、构建模式、设备和操作流程，重复采样，比较请求数/传输体积、交互延迟、主线程长任务、挂载与 DOM 增删。当前尚无这些耗时基线，因此本报告不声明“DOM 不是瓶颈”“默认十条不会卡”或具体收益百分比。
