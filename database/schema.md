# 场地预订系统 - 数据库 Schema（云函数倒推）

> 本文档由云函数实际读写字段倒推整理，适用于微信云开发 NoSQL 集合。

---

## 一、云开发集合

### 1. court（场地表）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| _id | string | 是 | 云开发主键，插入时自动生成 |
| campus | string | 是 | 校区，如「麓坊校区」「桐梓林校区」「雅居乐校区」 |
| courtNumber | string | 是 | 场地编号，如「1号风雨棚」「7号室外」 |

**使用云函数**：add_court（查重 campus+courtNumber、插入）、get_court_list_by_section（按 campus 查、按 courtNumber 排序）、get_court_order（按 campus 查场地列表）。

**唯一约束**：业务上 (campus, courtNumber) 唯一，由 add_court 插入前校验。

---

### 2. court_order_collection（场地订单/占用记录）

每条记录表示「某校区某场地某日期某时间段」的占用状态。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| _id | string | 是 | 云开发主键 |
| court_id | string | 是 | 业务主键，格式：`{courtNumber}_{date}_{start_time}`，如 `1号风雨棚_20250803_20:00` |
| campus | string | 是 | 校区，与 court 一致，用于按校区过滤 |
| courtNumber | string | 是 | 场地编号，与 court 一致 |
| date | string | 是 | 日期，YYYYMMDD，如 20250803 |
| start_time | string | 是 | 开始时间 HH:mm |
| end_time | string | 是 | 结束时间 HH:mm |
| status | string | 是 | free / locked / booked。locked=用户锁定待支付，booked=已确定（支付成功或管理员订场） |
| price | number | 否 | 该时段价格（元） |
| booked_by | string | 否 | 预订者标识：用户/管理员订场为手机号；畅打占用为 court_rush._id（由 source_type 区分） |
| source_type | string | 否 | 占用来源：COURT_RUSH=畅打占用，PAY_ORDER=普通预订，空=管理员订场 |
| version | number | 否 | 乐观锁版本号，更新时自增，默认 1 |
| created_at | date | 否 | 创建时间 |
| updated_at | date | 否 | 更新时间，locked 订单据此判断超时释放 |

**使用云函数**：update_court_order（增/改/版本控制）、get_court_order（按 date/campus/courtNumber 查、删过期 locked）、order_create_callback（支付成功将 court_ids 对应记录 status 改为 booked）、order_refund_callback（退款成功按 court_ids 删除记录）、cancel_order（删 locked 或管理员取消时删记录并改 pay_order 状态）。

**注意**：同一 (court_id, campus) 仅一条有效记录；get_court_order 会清理超时 locked（管理员 10 分钟、普通用户 6 分钟）。

**唯一索引**：建议 (court_id, campus) 唯一（court_id 已含 courtNumber）。若用 (court_id, campus, courtNumber) 建唯一索引报重复，说明历史有重复数据，可调云函数 `find_duplicate_court_orders` 查出后人工清理。

---

### 3. pay_order（支付订单表）

场地预订支付订单，与 court_order_collection 联动：支付成功将对应 court_id 置为 booked，退款成功删除对应 court_order_collection 记录。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| _id | string | 是 | 云开发主键 |
| outTradeNo | string | 是 | 商户订单号（微信），pay_order_create 用 MD5 生成 32 位 |
| phoneNumber | string | 是 | 下单用户手机号 |
| total_fee | number | 是 | 订单金额（元） |
| court_ids | array\<string\> | 是 | 本次预订的 court_id 列表，与 court_order_collection.court_id 对应 |
| campus | string | 是 | 校区，用于重复单校验、列表筛选 |
| status | string | 是 | PENDING / PAIDED / CANCEL / REFUNDED |
| payment_parmas | object | 否 | 微信支付调起参数，前端用 |
| paymentTimeoutMinutes | number | 否 | 支付超时分钟数 |
| paymentExpireTime | date | 否 | 支付截止时间 |
| createTime | date | 否 | 创建时间（服务端时间） |
| timeExpire | string | 否 | 微信 time_expire 格式 |
| paymentQueryTime | date | 否 | 首次发起支付查询的时间，用于过期 pending 判定（超 4 分钟未支付则删单） |
| paided_at | date | 否 | 支付成功时间，order_create_callback 写入 |
| refundStatus | string | 否 | 退款状态，如 SUCCESS / FAILED / PROCESSING |
| refundFailReason | string | 否 | 退款失败原因 |
| refundFailTime | date | 否 | 退款失败时间 |
| adminRefunded | boolean | 否 | 是否管理员发起退款 |
| adminRefundTime | date | 否 | 管理员退款操作时间 |
| adminPhoneNumber | string | 否 | 执行退款的管理员手机号 |
| adminRefundAttempt | boolean | 否 | 是否曾以管理员身份尝试退款（含失败） |
| outRefundNo | string | 否 | 退款单号 |

**使用云函数**：pay_order_create（插入 PENDING）、order_create_callback（改 PAIDED、写 paided_at）、order_refund_callback（改 REFUNDED、删 court_order_collection）、cancel_order（改 CANCEL、删 locked 占用）、my_order_list、pay_order_query、refund_order、admin_refund_order、special_order_list。get_court_order 会删除过期 PENDING（非管理员、超 4 分钟未支付或 paymentQueryTime 超 1 分钟）。

---

### 4. manager（管理员表）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| _id | string | 是 | 云开发主键 |
| phoneNumber | string | 是 | 管理员手机号，用于权限校验 |
| password | string | 否 | 管理员密码，admin_refund_order 校验用 |
| specialManager | number | 否 | 0 或 1，1 表示特殊管理员（可查全部已支付订单、可退款） |
| courtRushManager | number | 否 | 0 或 1，1 表示畅打管理员（可发起畅打）；权限低于 specialManager，specialManager=1 时天然具备畅打权限 |

**权限层级**：普通管理员 &lt; courtRushManager=1（畅打） &lt; specialManager=1（退款）。

**使用云函数**：update_court_order、get_court_order、cancel_order、manager_list、special_manager、special_manager_check、admin_refund_order、court_rush_create。

---

### 5. announcement（公告表）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| _id | string | 是 | 云开发主键 |
| date | date | 否 | 公告日期，用于排序，announcement 云函数按 date 倒序取前 3 条 |

**使用云函数**：announcement（orderBy date desc, limit 3）。其余展示用字段（标题、内容等）由前端约定，云函数未读写其他字段。

---

## 二、畅打模块（Court Rush）— 设计态

以下三表见 `court_rush/database_design.md`，当前由云函数倒推的代码中尚未实现，仅作 schema 预留与联动说明。

### 6. court_rush（畅打主表）

| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 主键 |
| court_ids | array\<string\> | 连续时间段场地 ID，与 court_order_collection.court_id 同格式 |
| campus | string | 校区 |
| max_participants | number | 参与人数上限 |
| current_participants | number | 已付人数（PAID enrollment 数）；闸门计数 |
| held_participants | number | 占位数（PENDING_PAYMENT 且未过期）；闸门计数 |
| price_per_person_yuan | number | 每人报名费（元） |
| status | string | OPEN / FULL / ENDED / CANCELLED |
| created_by | string | 创建者手机号（管理员） |
| start_at | date | 开始时间（便于筛选/展示） |
| end_at | date | 结束时间（便于筛选/展示） |
| created_at | date | 创建时间 |
| updated_at | date | 更新时间 |

创建畅打时需在 court_order_collection 中批量写入 booked，booked_by 为 court_rush._id，source_type 为 `COURT_RUSH`。

### 7. court_rush_enrollment（畅打报名表）

| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 主键 |
| court_rush_id | string | 关联 court_rush._id |
| phoneNumber | string | 会员手机号 |
| nickName | string | 微信昵称（必填） |
| avatarUrl | string | 微信头像URL（必填） |
| status | string | PENDING_PAYMENT / PAID / CANCEL_REQUESTED / CANCELLED / EXPIRED / REFUND_FAILED |
| is_vip | boolean | 是否 VIP（可选留痕） |
| actual_fee_yuan | number | 实收金额（元，VIP 五折等） |
| expires_at | date | 占位过期时间（仅 PENDING_PAYMENT） |
| created_at | date | 创建时间 |
| updated_at | date | 更新时间 |

### 8. court_rush_payment（畅打报名支付表）

与 pay_order 分离，专用于畅打报名费，不走 order_create_callback / order_refund_callback。

| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 主键 |
| outTradeNo | string | 商户订单号（微信）唯一 |
| wx_transaction_id | string | 微信支付单号（建议） |
| court_rush_id | string | 关联 court_rush._id |
| enrollment_id | string | 关联 court_rush_enrollment._id |
| phoneNumber | string | 用户手机号 |
| total_fee_yuan | number | 金额（元） |
| status | string | PENDING / PAIDED / CANCEL / REFUNDING / REFUNDED / FAILED |
| createTime | date | 创建时间 |
| paided_at | date | 支付成功时间 |
| refundTime | date | 退款成功时间（可选） |
| wx_refund_id | string | 微信退款单号（建议） |
| notify_time | date | 回调时间（建议） |
| created_at | date | 创建时间（冗余可统一） |
| updated_at | date | 更新时间 |

---

## 三、外部数据源（非云开发）

- **MySQL**：club_member（查 prepaid_card 按 number=phoneNumber）、charged_list（charge + prepaid_card）、spend_list（spend + prepaid_card + course + court + coach）。表结构未在本文档维护，见各业务文档或 DBA。
- **微信 openid**：getopenId 仅返回 openid/appid/unionid，不落库。
- **baseNumber**：通过微信 code 换手机号，不直接写云开发集合。
