# AGENTS.md

## 业务流程

系统定位：以订单驱动的**成品出入库管理**——维护`客户档案`、`销售订单`、`物料与BOM`（产品档案），记录成品进出台账。生产过程与原材料库存均在线下，系统不追踪：成品从"检验入库"进入系统，经"登记发货"离开系统。

核心链路：客户建档 → 维护物料与BOM → 开销售订单（挂客户 + BOM + 数量 + 交期）→ 仓管检验入库 → 对照"订单欠量 vs 库存"备货 → 仓管登记发货（回填订单已发数量）→ 管理员/超级管理员打印出库单随货走。

### 角色划分

本项目共五个角色：`超级管理员`、`管理员`、`仓管`、`销售`、`员工`。所有人都可以查看`成品出入库`、`物料与BOM`、`销售订单`信息；其余模块的可见范围与数据的更新、添加等写操作按角色受限如下：

| 模块       | 超级管理员               | 管理员            | 仓管                 | 销售     | 员工   |
| ---------- | ------------------------ | ----------------- | -------------------- | -------- | ------ |
| 成品出入库 | 全部权限（含打印出库单） | 只读 + 打印出库单 | 全部权限（不含打印） | 只读     | 只读   |
| 客户档案   | 全部权限                 | 全部权限          | 不可见               | 全部权限 | 不可见 |
| 用户权限   | 全部权限                 | 不可见            | 不可见               | 不可见   | 不可见 |
| 物料与BOM  | 全部权限                 | 全部权限          | 只读                 | 全部权限 | 只读   |
| 销售订单   | 全部权限                 | 全部权限          | 只读                 | 全部权限 | 只读   |

- **超级管理员**：全部模块（`成品出入库`、`客户档案`、`用户权限`、`物料与BOM`、`销售订单`）的全部权限，是唯一可操作`用户权限`的角色，同时拥有出入库写操作（检验入库、登记发货）和打印出库单权限。
- **管理员**：拥有`客户档案`、`物料与BOM`、`销售订单`全部权限；`成品出入库`只读，可打印出库单，但不能检验入库、登记发货；`用户权限`不可见。
- **仓管**：拥有`成品出入库`全部写权限（检验入库、登记发货），但没有打印出库单权限；`物料与BOM`、`销售订单`只读；`客户档案`、`用户权限`不可见。
- **销售**：拥有`客户档案`、`物料与BOM`、`销售订单`全部权限；`成品出入库`只读且不可打印出库单；`用户权限`不可见。
- **员工**：仅可查看`成品出入库`、`物料与BOM`、`销售订单`，无任何写权限；`客户档案`、`用户权限`不可见。

### 权限设计原则

- **库存台账只由仓管写入**（超级管理员兜底），管理员、销售只读，保证账实数据出于一门。
- **客户资料只对销售线可见**（超级管理员/管理员/销售）：仓管发货只需订单信息，员工不可见。
- **操作与单据分离**：仓管可登记发货但不能打印出库单；管理员可打印出库单但不能登记发货。
- **出入库台账不可删**：记录不允许删除，写权限仅限新增和修改，保证流水可追溯。

## 项目结构

```
admin-manage/
├── index.html                  # Vite 入口 HTML
├── vite.config.ts              # Vite 配置（Tailwind 插件 + "@" 别名指向 src/）
├── tsconfig.json               # TS 工程引用配置（app / node 两个子配置）
├── .oxlintrc.json              # oxlint 规则配置
├── .oxfmtrc.json               # oxfmt 格式化配置（pnpm format：3 空格缩进 / 120 列 / 单参箭头免括号）
├── docs/db-scheme.md           # 数据库设计文档
├── docs/api/openapi.yaml       # API 契约（交付后端，与 TS 类型 / MSW handlers 三方对齐）
├── .env.example                # 环境变量样例（VITE_API_BASE_URL / VITE_ENABLE_MSW）
├── mocks/                      # MSW mock（开发模式拦截 /api/*，生产构建不打包；与 src 平级的"假后端"）
│   ├── browser.ts              # setupWorker
│   ├── data/                   # 数据 mock：内存数据库 db.ts（种子数据 + 业务规则，
│   │                           #   日期锚点动态取今天；node --test 可直接导入）
│   └── request/                # 请求 mock：handlers（auth / business / system）
├── public/                     # 静态资源（favicon.svg、icons.svg、mockServiceWorker.js）
├── scripts/                    # 工具脚本
│   ├── inventory.test.mjs      # 库存业务逻辑测试（pnpm test，直跑 TS，被测模块的
│   │                           #   运行时导入须用相对路径 + .ts 扩展名）
│   ├── shot.mjs                # 应用截图脚本（puppeteer-core）
│   └── shot-*.mjs              # 交互页 / 权限原型截图脚本
└── src/                        # 路径别名 "@" → src/
    ├── main.tsx                # 应用入口（DEV 且未关闭 MSW 时先启动 mock worker）
    ├── index.css               # 全局样式（Tailwind + 设计令牌）
    ├── router.tsx              # 路由定义（/login 独立路由 + AppLayout 认证/菜单守卫）
    ├── http/                   # 请求基础设施（与业务无关，vben 风格裁剪版）
    │   ├── index.ts            # barrel 出口：requestClient / ApiError / token 工具
    │   ├── request-client.ts   # RequestClient 类（axios 实例 + 类型化方法）
    │   ├── client.ts           # 单例组装：token 注入、信封解包、401 跳登录、错误归一
    │   ├── token.ts            # accessToken 存取（localStorage）
    │   └── errors.ts / types.ts / interceptor-manager.ts
    ├── api/                    # 业务 API 契约层（依赖 http，端点与 openapi.yaml 对齐）
    │   ├── index.ts            # api 出口（fetchSnapshot 聚合 + 旧方法面兼容 queries.ts）
    │   ├── types.ts            # 契约类型中心
    │   └── auth.ts / orders.ts / customers.ts / boms.ts / inbound.ts /
    │       outbound.ts / users.ts / permissions.ts / events.ts
    ├── components/
    │   ├── charts/             # ECharts 封装（EChart.tsx 通用组件、options.ts 图表配置）
    │   ├── layout/             # 页面外壳（Shell.tsx：侧边导航 + 顶栏 + 移动底栏）
    │   └── ui/                 # 通用 UI 组件（Modal、Toast、Pagination、Badge、
    │                           #   Field、KpiCard、MobileList、PageHeading、
    │                           #   SearchSelect、ToolbarMore、cells 表格单元格）
    ├── context/
    │   └── AppContext.tsx      # 认证上下文（登录用户 / 角色授权 / login、logout、can()）
    ├── data/                   # 领域层（不发请求，职责详见 src/data/readme.md）
    │   ├── queries.ts          # react-query 查询/变更封装
    │   ├── views.ts            # 派生视图纯函数（输入快照，工作台/列表页消费）
    │   ├── permissions.ts      # 角色/菜单/动作权限字典 + 纯派生工具（授权是后端数据）
    │   └── categories.ts       # 物料分类配置（前端常量，不落库）
    ├── lib/                    # 工具函数（format.ts 格式化、date.ts 日期、icons.tsx 图标）
    └── pages/                  # 页面模块（按业务域分目录）
        ├── login/              # 登录页
        ├── workbench/          # 工作台（WorkbenchPage、SearchPage 全局搜索、dialogs 弹窗）
        ├── inbound/            # 成品出入库 - 检验入库
        ├── outbound/           # 成品出入库 - 登记发货/出库单
        ├── customers/          # 客户档案
        ├── bom/                # 物料与BOM（产品档案）
        ├── orders/             # 销售订单
        └── permissions/        # 用户权限（账号管理 / 角色授权 / 权限矩阵）
```

### 数据流与契约

```
页面 → data/queries.ts(react-query) → api/*(axios) → [MSW 拦截 | 真实后端]
```

- **登录鉴权**：`POST /auth/login` 换单 accessToken（localStorage `zm-token`），`GET /auth/profile` 下发用户 + 角色授权；401 由 http 层统一清 token 跳 `/login`。演示账号为 mock 种子用户（`mocks/data/db.ts`，密码均 `123456`）。
- **权限渲染**：菜单/按钮字典在前端常量（`data/permissions.ts`），授权关系是后端数据（sys_grant），登录后经 profile 下发；角色授权编辑走 `PUT /roles/{roleId}/grants`。
- **Mock 开关**：开发模式默认启用 MSW；设 `VITE_ENABLE_MSW=false` 联调真实后端，业务代码零改动。
- **统计前端算**：后端只出基础资源 CRUD，工作台派生视图（待发货/缺口/趋势/TOP 客户）由 `data/views.ts` 基于聚合快照计算；库存 = Σ入库 − Σ出库。
- **契约同步**：改接口须同步三处——`src/api/types.ts`、`src/mocks/request/`、`docs/api/openapi.yaml`。

### 导入与桶（barrel）策略

- **设桶的目录**：`src/http/index.ts`（请求基础设施）、`src/api/index.ts`（业务契约层）。消费者一律从桶导入（`@/http`、`@/api`），**类型同样走桶**（如 `import type { Order } from "@/api"`），不深路径直达 `@/api/types`、`@/api/auth` 等内部模块。
- **桶只做出口**：桶文件只写显式 named re-export（禁 `export *`、禁 default），不放业务逻辑；聚合/适配逻辑下沉到具体模块（如 `api/snapshot.ts`、`data/queries.ts` 的签名适配）。
- **不设桶的目录**：`components/ui`、`data`、`lib`、`pages`——按文件直接从 `@/...` 具名导入，避免无效聚合层。
- **路径风格**：跨目录一律 `@/` 别名（含动态 `import("@/...")`）；仅 `src` 根文件（main/router）可用 `./` 相对。
- **例外（勿"好心修复"）**：`src/data/views.ts` 与 `src/mocks/data/db.ts` 被 `pnpm test`（Node 直跑 TS）引用，Node 不解析 `@/` 别名，因此这两个文件对 `data/`、`lib/` 的**运行时值导入必须保留相对路径 + `.ts` 扩展名**（type 导入会被擦除，不受限）。
- **层级方向**：`components` 不得反向依赖 `pages`（通用弹窗等下沉 `components/ui`）；页面之间目前的跨页 Modal 互引是已知网状，新增引用前先确认不会成环。
