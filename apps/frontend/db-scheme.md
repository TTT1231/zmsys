# 数据库表结构设计文档

## 0. 全局约定

- **主键 id**：bigint，**已确定由应用层雪花算法（Snowflake）生成**——并发安全、趋势递增、不暴露业务规模。（表结构与 AUTO_INCREMENT 自增完全相同，仅号的来源不同。）
- **外键**：一律指向被关联表的**主键 id**，不指向业务编码。
- **业务编码**（customer_code / bom_code / order_no / no）：仅供人阅读与检索，不参与表关联。
- **API / 前端对接**：接口与页面一律使用业务编码（order_no / customer_code / bom_code / 单号 no / 用户账号 account），**不传输、不使用雪花 id**；用户操作（启停、编辑）以 account 定位。
- **账号不可改**：sys_user.account 创建后不允许修改（name 可改），需要变更账号时停用重建——account 是前端定位用户的唯一键。
- 保险措施：若个别接口确需回传 id，后端将 Long 序列化为字符串（64 位雪花超出 JS Number 安全整数范围，直接发数字会被 JSON.parse 静默截断成错值）。

## 1. 基础业务表

### 1.1 客户表 (custom_table)

| 字段名         | 数据类型 | 说明/备注                               |
| :------------- | :------- | :-------------------------------------- |
| id             | bigint   | 主键                                    |
| customer_code  | varchar  | 客户编码 (CUS_开头数字唯一)             |
| name           | varchar  | 客户名称                                |
| contact_person | varchar  | 联系人                                  |
| contact_phone  | varchar  | 联系人电话                              |
| region         | varchar  | 省/市/县/乡                             |
| address        | varchar  | 详细地址                                |
| owner_id       | bigint   | 所属销售 (外键 → sys_user.id，role=sales 的用户) |
| pay_terms      | varchar  | 付款条件                                |
| status         | int      | 客户状态 (停用、启用，用作历史记录查看) |
| created_at     | datetime | 审计时间                                |
| updated_at     | datetime | 审计时间                                |

> **备注**：合作状态：聚合查询，不存字段

### 1.2 销售订单表 (sales_order_table)

| 字段名       | 数据类型 | 说明/备注                     |
| :----------- | :------- | :---------------------------- |
| id           | bigint   | 主键                          |
| order_no     | varchar  | 订单号 (唯一，例如Z260303086) |
| customer_id  | bigint   | 客户ID (外键)                 |
| bom_id       | bigint   | 对应的bom (外键)              |
| qty          | int      | 订单数量                      |
| order_date   | date     | 下单日期                      |
| deliver_date | date     | 交货日期                      |
| remark       | text     | 订单备注                      |
| created_at   | datetime | 审计时间                      |
| updated_at   | datetime | 审计时间                      |

### 1.3 产品/BOM表 (bom_table)

| 字段名     | 数据类型 | 说明/备注                                                    |
| :--------- | :------- | :----------------------------------------------------------- |
| id         | bigint   | 主键                                                         |
| bom_code   | varchar  | 编码（唯一，`ZM+品类码+3位序号`，如 ZMXK001/ZMKW001/ZMDD001） |
| name       | varchar  | 品类（旋转开关 / 微动开关 / 跌倒开关…，按需扩充）             |
| model_code | varchar  | 型号（各品类通用语义，如 2-1、KW-1、DD-1）                   |
| spec       | JSON     | 品类专属规格键值对，只存该品类用到的键，示例见下              |
| unit       | varchar  | 单位（个）                                                   |
| created_at | datetime | 审计时间                                                     |
| updated_at | datetime | 审计时间                                                     |

> **设计说明**：
> - 不同品类的规格维度不同（旋转开关有脚位/档位，微动开关有触点形式/动作力），固定列会导致稀疏宽表且每加品类都要改表结构，故用 JSON 按品类存键值，加新品类零 DDL。
> - 品类模板（各品类有哪些规格键、下拉选项）由前端常量维护（`src/data/categories.ts`），不落库；后端仅校验品类存在与必填项。
> - 编码前缀映射：旋转开关 XK、微动开关 KW、跌倒开关 DD；序号在各品类内独立自增。
> - 需要按某个规格属性检索时，用 MySQL 8 虚拟列 + 索引按需提取，例如：
>   `ALTER TABLE bom_table ADD COLUMN foot VARCHAR(16) GENERATED ALWAYS AS (spec->>'$.脚位') VIRTUAL, ADD INDEX idx_foot (foot);`

`spec` JSON 示例：

```jsonc
// 旋转开关 ZMXK001（键名沿用原版口径：规格 / 方向 / 弹簧）
{"脚位":"三脚","档位":"两档","规格":"222-1","方向":"正面","银点厚度":"0.2","弹簧":"0.5","杆子高度":"4.8","A面触点":"A面银点","B面触点":"B面塑料盖板"}
// 微动开关 ZMKW001
{"触点形式":"常开","动作力":"160gf","行程":"0.25mm","额定电流":"5A 250VAC"}
// 跌倒开关 ZMDD001
{"感应角度":"±30°","输出信号":"常开","额定电流":"2A 30VDC"}
```

### 1.4 入库流水表 (inbound_ledger)

| 字段名     | 数据类型 | 说明/备注                                |
| :--------- | :------- | :--------------------------------------- |
| id         | bigint   | 主键                                     |
| no         | varchar  | 入库单号 (唯一)                          |
| bom_id     | bigint   | 外键                                     |
| qty        | int      | 本次入库数量                             |
| in_date    | datetime | 入库时间                                 |
| operator_id| bigint   | 操作人 (外键 → sys_user.id，显示时 join) |
| remark     | varchar  | 备注                                     |
| created_at | datetime | 审计时间                                 |
| updated_at | datetime | 审计时间 (支持更正记录)                  |

### 1.5 出库流水表 (outbound_ledger)

| 字段名     | 数据类型 | 说明/备注                                |
| :--------- | :------- | :--------------------------------------- |
| id         | bigint   | 主键                                     |
| no         | varchar  | 出库单号 (唯一)                          |
| order_id   | bigint   | 订单 (外键 → sales_order_table.id)        |
| qty        | int      | 本次出库数量                             |
| out_date   | datetime | 出库时间                                 |
| operator_id| bigint   | 操作人 (外键 → sys_user.id，显示时 join) |
| remark     | varchar  | 备注                                     |
| created_at | datetime | 审计时间                                 |
| updated_at | datetime | 审计时间 (支持更正记录)                  |

---

## 2. 系统权限表

### 2.1 用户表 (sys_user)

> _注：原图中该表重复出现两次，内容一致。_

| 字段名        | 数据类型 | 说明/备注                                              |
| :------------ | :------- | :----------------------------------------------------- |
| id            | bigint   | 主键                                                   |
| account       | varchar  | 账号 (唯一)                                            |
| password_hash | varchar  | 密码哈希 (初始统一 123456 的散列，登录后强制改密)      |
| name          | varchar  | 姓名                                                   |
| role          | varchar  | 角色 (super/admin/warehouse/sales/staff)               |
| status        | tinyint  | 状态 (1 启用 / 0 停用，停用不删除)                     |
| last_login_at | datetime | 最后登录时间                                           |
| created_at    | datetime | 审计时间                                               |
| updated_at    | datetime | 审计时间                                               |

### 2.2 授权表 (sys_grant)

> _注：主键为 (role, code) 联合主键——一个角色对一个授权码最多一行。_

| 字段名     | 数据类型 | 说明/备注                                       |
| :--------- | :------- | :---------------------------------------------- |
| role       | varchar  | 角色代码 (联合主键之一)                         |
| code       | varchar  | 授权码（例如：orders页面 / outbound:ship 操作）(联合主键之一) |
| granted_at | datetime | 写入时间                                        |

---

## 💡 关联关系推断说明 (基于外键)

- `sales_order_table` 关联 `custom_table` (多对一，customer_id → 客户表 id) 和 `bom_table` (多对一)。
- `custom_table` 的 `owner_id` 关联 `sys_user` (多对一，所属销售)。
- `inbound_ledger` 关联 `bom_table` (多对一)。
- `outbound_ledger` 的 `order_id` 关联 `sales_order_table` (多对一)；客户与 BOM 信息经订单间接取得。
- `inbound_ledger` / `outbound_ledger` 的 `operator_id` 关联 `sys_user` (多对一，显示操作人姓名时 join)。

---

## 📌 待办 (表结构确认后再加)

- **唯一索引**（防止重复数据，建表时一并加即可）：
  - `custom_table.customer_code`
  - `sales_order_table.order_no`
  - `bom_table.bom_code`
  - `inbound_ledger.no`
  - `outbound_ledger.no`
  - `sys_user.account`
