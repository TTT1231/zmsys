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
├── tsconfig.json               # TS 工程引用配置（app / node 两个子配置）
├── docs/db-scheme.md           # 数据库设计文档
├── docs/api/openapi.yaml       # API 契约（交付后端，与 TS 类型 / MSW handlers 三方对齐）
├── .env.development            # 环境变量默认配置（VITE_API_BASE_URL / VITE_ENABLE_MSW，无敏感信息入库）
├── mocks/                      # MSW mock（开发模式拦截 /api/*，生产构建不打包；与 src 平级的"假后端"）
│   ├── browser.ts              # setupWorker
│   ├── data/                   # 数据 mock：内存数据库 db.ts（种子数据 + 业务规则，
│   │                           #   日期锚点动态取今天；node --test 可直接导入）
│   └── request/                # 请求 mock：index 聚合出口 + handlers（auth / business / system）+ shared 工具
├── public/                     # 静态资源（favicon.svg、icons.svg、mockServiceWorker.js）
├── scripts/                    # 工具脚本
│   └── inventory.test.mjs      # 库存业务逻辑测试（pnpm test，直跑 TS，被测模块的
│                               #   运行时导入须用相对路径 + .ts 扩展名）
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
    │   ├── index.ts            # barrel 出口（类型经 export type * 转发，函数显式 re-export）
    │   ├── types.ts            # 契约类型中心
    │   ├── snapshot.ts         # fetchSnapshot：多资源端点聚合快照（库存由台账推导）
    │   └── auth.ts / orders.ts / customers.ts / boms.ts / inbound.ts /
    │       outbound.ts / users.ts / permissions.ts / events.ts
    ├── components/
    │   ├── charts/             # ECharts 封装（EChart.tsx 通用组件、options.ts 图表配置）
    │   ├── layout/             # 页面外壳（Shell.tsx：侧边导航 + 顶栏 + 移动底栏）
    │   └── ui/                 # 通用 UI 组件（Modal、Toast、Pagination、Badge、
    │                           #   Field、MobileList、NoteDialog、PageHeading、
    │                           #   SearchSelect、ToolbarMore、cells 表格单元格）
    ├── context/
    │   └── AppContext.tsx      # 认证上下文（登录用户 / 角色授权 / login、logout、can()）
    ├── data/                   # 领域层（不发请求，职责详见 src/data/README.md）
    │   ├── queries.ts          # react-query 查询/变更封装
    │   ├── views.ts            # 派生视图纯函数（输入快照，工作台/列表页消费）
    │   ├── permissions.ts      # 角色/菜单/动作权限字典 + 纯派生工具（授权是后端数据）
    │   ├── categories.ts       # 物料分类配置（前端常量，不落库）
    │   └── README.md           # 领域层职责与同步约定
    ├── lib/                    # 工具函数（format.ts 格式化/CSV 导出、date.ts 日期、icons.tsx 图标）
    └── pages/                  # 页面模块（按业务域分目录）
        ├── login/              # 登录页
        ├── workbench/          # 工作台（WorkbenchPage、SearchPage 全局搜索、dialogs 台账弹窗）
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
- **统计前端算**：后端只出基础资源 CRUD，工作台派生视图（待发货/缺口/趋势）由 `data/views.ts` 基于聚合快照计算；库存 = Σ入库 − Σ出库。
- **契约同步**：改接口须同步三处——`src/api/types.ts`、`src/mocks/request/`、`docs/api/openapi.yaml`。

## Tailwind v4 样式约定

- **优先原生刻度类，`[...]` 任意值是最后手段**：v4 工具类动态生成，数值直接写——例如`py-[3px]` → `py-0.75`等。
