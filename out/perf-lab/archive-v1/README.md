# v1 归档（2026-09-30）

- 采集时间：2026-09-30；git HEAD 见 git-head.txt（工作区干净，仅 out/ 与 apps/frontend/test/perf/ 未跟踪）。
- 环境：本机有头系统 Chrome（playwright-core 驱动）、自写静态+API 反代、后端编译产物指向 zmdb_test。
- 数据：e2e-1x/10x/50x/100x.json、micro.json、volume.json（生产量级裁决依据）。
- scripts/ 为 v1 采集器与工具快照；apps/frontend/test/perf/core.bench.ts 同步快照。

## v1 已知缺陷（v2 修正的对象，报告引用 v1 数据时须按此打折）

1. bom-search 每键延迟存在跨键错误归因（scenarios.mjs `if (pending) return`）：前一键无可见变更时，后一键的 DOM 更新被记到前一键的 t0 上。avg/max 键延迟不可信。
2. metrics.mjs summarizeTrace 按事件名直接累加 dur，未处理父子包含关系：scriptMs/layoutMs/paintMs 为含重复计数的名义和，不能当真实总时长或做差额分解。
3. bom-usage-filter 在 10x+ 的 ~20.7s 由采集器固定时序主导（waitForSelector 20s 等待不会出现的数据行按钮），非页面耗时。
4. e2e 的品类分布随 √F 增长（seed-topup.ts bom_category × √F），选择器"100x 最大品类 78 项"结论依赖该分布假设，不代表品类数不变的业务。
5. micro p2-ready-counts 的 n≥2000 三档为外推预估（试跑均值 × 活跃单数），非实测中位数。
6. p6-page-summary 只测 BomCell 组挂载（Profiler actualDuration(mount)），不含 DataTable/移动外壳/卸载/布局绘制，不能作整表或双份布局的上限。
