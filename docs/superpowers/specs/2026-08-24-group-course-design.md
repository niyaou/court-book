# 小程序单次公开团体教学课设计

日期：2026-08-24

## 1. 目标

在现有微信小程序内增加单次公开团体教学课。具备畅打发起权限的管理员创建草稿并发布课程；用户以本人手机号报名并通过微信支付取得名额。系统必须处理名额并发、课程最低人数、自动取消、全额退款，以及受小程序管理场地的占用和释放。

团课是独立的 CloudBase 子系统。它不复用畅打业务代码，不读写远端 MySQL 的课程、教练或会员课程表，也不进入现有教练正式课程和月度授课统计。

## 2. 非目标

- 不设计课程页面的最终视觉样式，也不使用课程图片或教练头像作为课程主图。
- 不做固定周期班、多场次课程包、多人代报、候补、签到或教练端入口。
- 不允许管理员修改已发布课程。
- 不同步远端 MySQL 正式课程。
- 不发送小程序订阅消息；微信支付渠道自行发送支付和退款通知。
- 不改造普通订场和畅打业务流程。团课只在受管理校区发布或取消时与现有场地占用集合交互。
- 自动测试不连接真实 CloudBase、微信支付或测试数据库。

## 3. 已确认业务规则

### 3.1 发布与课程

- 团课由管理员在小程序发布，权限与畅打发起一致：`courtRushManager >= 1` 或 `specialManager >= 1`。
- 课程可保存为草稿。草稿可以修改和删除；删除采用状态标记，不物理删除。
- 课程一旦发布，标题、说明、教练、校区、场地、时间、价格、最低人数和人数上限均不可修改。需要变更时，整体取消后重新创建。
- 每节课关联一位 CloudBase `coach` 集合中的教练。教练仅作为课程展示数据，不获得团课页面或报名名单入口。
- 每节课只能选择一个校区、一个场地和同一自然日内的一段连续时间。开始和结束时间必须按 30 分钟对齐。
- 同一教练的团课时间不能重叠；同一校区同一场地的团课时间不能重叠；同一校区不同场地可以同时开课。
- 业务前提是管理员不会并发发布课程，因此教练和团课场地冲突采用发布时查询校验，不增加独立资源卡位集合。
- 管理员可以在课程发布后任何时候整体取消，包括课程已经开始或完成之后。

### 3.2 校区与场地

- 新建 CloudBase `campus` 集合，字段仅为 `name`、`enabled`、`sortOrder`、`bookingManaged`。
- `campus` 是团课可选校区集合，也是现有 `court` 集合中校区的超集。
- 场地列表继续从现有 `court` 集合按所选 `campus` 查询，不改变 `court` 的现有校区逻辑。
- `bookingManaged=false` 时，团课只保存校区、场地和时间，不写入场地占用。
- `bookingManaged=true` 时，发布和取消必须与现有 `court_order_collection` 交互。该集合是普通订场、畅打和团课共同的场地竞争点。

### 3.3 报名、价格和名额

- 一个手机号在一节课程中只能有一条报名记录，只能为本人报名一个名额。
- 报名业务身份使用手机号，不使用 `openid`。微信 JSAPI 下单需要 `openid` 时，云函数从微信上下文临时取得，且不把它作为报名业务键。
- VIP 判定沿用现有畅打规则：手机号对应的会员账户余额、次卡或年卡折算价值大于 0 时视为 VIP。
- 课程原价以元保存。非 VIP 支付原价；VIP 实付金额为 `floor(原价 × 0.8)` 元，即八折后直接抹去不足一元部分。
- 新报名在开课前 1 小时截止。服务端在截止时间前接受了报名占位后，后续付款不再受报名截止限制。
- 微信付款单有效期为创建后 2 分钟。过期后不能继续支付，也不能在原占位内生成新付款单。
- 名额占位从本轮报名开始起保留 3 分钟。第 2 至第 3 分钟只用于等待回调和主动查单；确认未支付后才释放。
- 占位释放后，只要未到报名截止时间且课程未满，用户可以重新发起一轮报名。
- 不做候补。只要当前有效占位未达到上限，其他用户就可以报名。
- `group_course` 不保存 `heldCount`、`paidCount` 或其他参与人数缓存。展示人数、占用名额和最低开课人数均聚合个人报名记录得出。

### 3.4 取消、成班与退款

- 用户可在开课前 6 小时之外自助取消，按实际支付金额发起全额原路退款，不收手续费。
- 只有收到微信退款成功结果后才释放名额。退款处理中或退款失败时仍占用名额。
- 退款成功释放名额后，只要未到报名截止时间且课程未满，课程自动恢复可报名。
- 报名截止后等待最长 3 分钟，使截止前进入的付款流程完成。之后聚合 `PAID` 报名：达到最低人数则成班，未达到则自动整体取消并逐笔退款。
- 管理员整体取消时立即禁止新报名并释放受管理场地；已支付报名随后逐笔退款。课程取消不等待退款全部完成。
- 课程、报名、支付和退款记录均不物理删除。普通公开列表不显示已取消课程；报名用户在“我的团课”中仍能查看已取消课程和退款状态。

## 4. 架构与组件

### 4.1 页面

- `pages/groupCourse/groupCourse`
  - 同一页面切换“团课列表”和“我的团课”。
  - 普通用户公开列表不显示草稿和已取消课程。
  - 管理员在同一页面额外看到草稿、已取消课程和创建入口，不增加独立管理列表。
- `pages/groupCourseDetail/groupCourseDetail`
  - 用户查看课程、报名、支付和退款状态。
  - 管理员额外查看完整报名名单、整体取消和退款异常处理入口。
- `pages/groupCourseForm/groupCourseForm`
  - 仅管理员创建、编辑草稿和发布。
  - 已发布课程不能进入编辑状态。

具体页面视觉布局不在本设计范围内。

### 4.2 云函数

只新增四个云函数：

1. `group_course`
   - 通过 `action` 分发普通业务：`context`、`list`、`detail`、`saveDraft`、`deleteDraft`、`publish`、`enroll`、`cancelEnrollment`、`cancelCourse`、`retryRefund`。
   - 入口文件只负责输入规范化、鉴权和分发；校验、仓储、定价、报名事务、发布事务、退款等拆成团课内部模块。
2. `group_course_payment_callback`
   - 微信支付成功的权威回调入口，独立部署并保持幂等。
3. `group_course_refund_callback`
   - 微信退款结果的权威回调入口，独立部署并保持幂等。
4. `group_course_maintenance`
   - 每分钟定时执行过期占位清理、未决支付查单、成班判断、最低人数自动取消、课程完成和退款重试。

不增加独立 `group_course_pay_query`。前端支付成功后刷新详情；详情可在付款创建后的 2 分钟内向报名本人返回原支付参数。定时任务内部的微信主动查单不暴露为用户接口。

### 4.3 权限边界

- 所有业务集合禁止小程序端直接写入；写操作全部经过云函数。
- 服务端每次管理员操作都重新查询 `manager` 集合，不能依赖前端隐藏按钮或全局缓存。
- 普通用户不能读取草稿、管理员操作字段、其他用户完整手机号或退款错误详情。
- 已取消课程详情只允许报名过的手机号和管理员读取。

## 5. 数据模型

### 5.1 `campus`

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 校区名称 |
| `enabled` | boolean | 是否可用于团课 |
| `sortOrder` | number | 展示顺序 |
| `bookingManaged` | boolean | 是否需要与现有订场系统交互 |

### 5.2 `group_course`

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 课程 ID |
| `status` | string | `DRAFT`、`PUBLISHED`、`CONFIRMED`、`COMPLETED`、`CANCELLED`、`DELETED`；`DELETED` 仅用于草稿软删除 |
| `title` / `description` | string | 课程标题和说明 |
| `coachId` / `coachName` | string | CloudBase 教练 ID 和发布快照 |
| `campus` / `courtId` / `courtNumber` | string | 校区与场地快照 |
| `bookingManaged` | boolean | 发布时的校区管理方式快照 |
| `courtIds` | string[] | 受管理场地的连续半小时时段业务键；未管理校区为空数组 |
| `startAt` / `endAt` | Date | 课程起止时间 |
| `minParticipants` / `maxParticipants` | number | 最低开课人数和人数上限 |
| `priceYuan` | number | 非 VIP 原价，单位元 |
| `enrollmentVersion` | number | 报名状态乐观锁版本，不表示人数 |
| `createdBy` / `publishedBy` / `cancelledBy` | string | 对应管理员手机号 |
| `createdAt` / `updatedAt` / `publishedAt` / `cancelledAt` | Date | 状态时间 |
| `cancelReason` | string | 管理取消或最低人数不足原因 |

所有截止时间均从 `startAt` 和硬编码常量计算，不保存为字段。

### 5.3 `group_course_enrollment`

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 报名 ID，使用“课程 ID + 手机号”的稳定哈希生成，便于事务按文档读取 |
| `courseId` | string | 课程 ID |
| `phoneNumber` | string | 报名身份 |
| `nickName` / `avatarUrl` | string | 报名时用户资料快照 |
| `status` | string | `PENDING_PAYMENT`、`PAID`、`EXPIRED`、`REFUNDING`、`REFUND_FAILED`、`CANCELLED` |
| `isVip` | boolean | 支付时 VIP 判定快照 |
| `originalPriceYuan` / `actualFeeYuan` | number | 原价和实付金额快照 |
| `attemptStartedAt` | Date | 当前一轮报名开始时间，用于计算 3 分钟占位 |
| `paymentId` / `refundId` | string | 当前支付和退款记录 |
| `paidAt` / `cancelledAt` | Date | 状态时间 |
| `createdAt` / `updatedAt` | Date | 审计时间 |

不保存占位截止时间。

容量聚合规则：

- 占用名额：`PENDING_PAYMENT`、`PAID`、`REFUNDING`、`REFUND_FAILED`。
- 不占名额：`EXPIRED`、`CANCELLED`。
- 已报名展示人数和最低开课人数：只统计 `PAID`。

### 5.4 `group_course_payment`

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 支付记录 ID |
| `courseId` / `enrollmentId` | string | 业务关联 |
| `phoneNumber` | string | 付款手机号 |
| `outTradeNo` / `wxTransactionId` | string | 商户和微信支付单号 |
| `amountYuan` | number | 实付金额，单位元 |
| `status` | string | `PENDING`、`PAIDED`、`EXPIRED`、`FAILED` |
| `paymentParams` | object | 2 分钟内可向报名本人返回的微信支付参数 |
| `createdAt` / `updatedAt` / `paidAt` / `notifyAt` | Date | 状态时间 |
| `failureCode` / `failureMessage` | string | 失败信息 |

不保存付款截止时间；通过 `createdAt + 2 分钟` 计算。金额在调用微信接口时转换为整数分。

### 5.5 `group_course_refund`

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 退款记录 ID |
| `courseId` / `enrollmentId` / `paymentId` | string | 业务关联 |
| `outRefundNo` / `wxRefundId` | string | 商户和微信退款单号 |
| `amountYuan` | number | 全额退款金额，单位元 |
| `reason` | string | 用户取消、管理员取消或最低人数不足 |
| `status` | string | `PROCESSING`、`SUCCESS`、`FAILED` |
| `retryCount` / `nextRetryAt` | number / Date | 重试控制 |
| `failureCode` / `failureMessage` | string | 最近失败信息 |
| `createdAt` / `updatedAt` / `succeededAt` | Date | 状态时间 |

## 6. 索引

部署前必须建立并核对以下索引：

| 集合 | 索引 | 类型 | 用途 |
|---|---|---|---|
| `campus` | `name` | 唯一 | 防止重复校区 |
| `campus` | `(enabled, sortOrder)` | 普通组合 | 团课校区列表 |
| `court` | `campus` | 普通 | 按校区读取场地 |
| `coach` | `(enabled, name)` | 普通组合 | 读取启用的 CloudBase 教练 |
| `court_order_collection` | `(campus, court_id)` | 唯一组合 | 普通订场、畅打和团课共用场地时段竞争 |
| `group_course` | `(status, startAt)` | 普通组合 | 公开列表和定时任务 |
| `group_course` | `(coachId, status, startAt)` | 普通组合 | 教练时间冲突检查 |
| `group_course` | `(campus, courtNumber, status, startAt)` | 普通组合 | 团课场地时间冲突检查 |
| `group_course_enrollment` | `(courseId, phoneNumber)` | 唯一组合 | 每手机号每课程唯一报名 |
| `group_course_enrollment` | `(courseId, status)` | 普通组合 | 人数和容量聚合 |
| `group_course_enrollment` | `(phoneNumber, createdAt)` | 普通组合 | 我的团课 |
| `group_course_enrollment` | `(status, attemptStartedAt)` | 普通组合 | 全局过期占位扫描 |
| `group_course_payment` | `outTradeNo` | 唯一 | 支付回调幂等定位 |
| `group_course_payment` | `(enrollmentId, createdAt)` | 普通组合 | 报名支付历史 |
| `group_course_refund` | `outRefundNo` | 唯一 | 退款幂等 |
| `group_course_refund` | `paymentId` | 唯一 | 一笔已支付订单只做一次全额退款 |
| `group_course_refund` | `(status, nextRetryAt)` | 普通组合 | 退款重试扫描 |

`court_order_collection` 建唯一索引前必须先检查并清理历史重复 `(campus, court_id)` 记录。本期不重构普通订场和畅打云函数。

## 7. 关键流程

### 7.1 草稿与发布

1. `saveDraft` 校验管理员权限并保存可编辑草稿。
2. `publish` 重新校验权限、必填字段、整数人数、价格、同日连续半小时时间。
3. 查询 `campus`，确认启用并取得 `bookingManaged`；查询 `court`，确认场地属于校区；查询 CloudBase `coach`，确认教练有效。
4. 查询未取消团课，拒绝教练时间重叠和同校区同场地时间重叠。
5. 保存教练、校区、场地和管理方式快照。
6. 未管理校区直接在事务中把草稿变为 `PUBLISHED`。
7. 受管理校区生成全部 `court_id`，先在事务外按 `(campus, court_id)` 定位已有占用文档，再在同一服务端事务中按文档 ID 重读、取得或创建每个占用，并把草稿变为 `PUBLISHED`。新记录由唯一索引阻止并发重复插入。任一时段为 `locked` 或 `booked`、唯一索引冲突或事务失败时全部回滚，课程保持草稿。
8. 团课占用写入 `status=booked`、`source_type=GROUP_COURSE`、`group_course_id=<课程ID>`。

### 7.2 无人数缓存的并发报名

`enrollmentVersion` 只作为乐观锁，不参与人数判断。

每次报名尝试执行以下重试循环：

1. 读取课程及当前 `enrollmentVersion`。
2. 聚合占用名额状态的 `group_course_enrollment`。
3. 校验课程可报名、报名截止、手机号唯一和聚合数量小于 `maxParticipants`。
4. 预先完成会员/VIP 查询、金额计算和商户订单号生成；事务内不调用外部接口。
5. 开启事务并按 ID 重读课程。如果版本或课程状态已变化，终止本轮并从第一步重新统计。
6. 版本未变化时，按确定性“课程 + 手机号”定位报名记录，创建或重新激活报名，创建 `PENDING` 支付记录，并执行 `enrollmentVersion + 1`。
7. 事务提交后调用微信统一下单，再把支付参数写回支付记录。
8. 微信下单失败时运行补偿事务：支付改为 `FAILED`、报名改为 `EXPIRED`、`enrollmentVersion + 1`。
9. 写冲突有限次数重试；每次重试必须重新聚合，不能使用旧人数。

### 7.3 支付确认

1. 前端取得支付参数后调用 `wx.requestPayment`。
2. 前端成功仅用于提示和刷新详情，不作为业务支付成功依据。
3. `group_course_payment_callback` 按 `outTradeNo` 唯一定位支付记录。
4. 在事务中只把 `PENDING` 支付改为 `PAIDED`，报名从 `PENDING_PAYMENT` 改为 `PAID`，并执行 `enrollmentVersion + 1`。
5. 重复回调直接返回成功，不重复改变报名。
6. 若课程在回调前已整体取消，仍确认真实付款，随后为该支付创建全额退款，不能忽略已收资金。

### 7.4 占位过期

1. 付款创建后 2 分钟，详情不再返回支付参数。
2. 报名开始后 3 分钟，维护任务先主动查询微信订单。
3. 已支付则走统一支付确认逻辑；明确未支付或已关闭才在事务中把支付和报名改为 `EXPIRED`，并执行 `enrollmentVersion + 1`。
4. 微信查询失败或状态不明确时不释放，下次任务重试。

### 7.5 用户取消

1. 服务端判断请求到达时间早于 `startAt - 6 小时`，且报名为 `PAID`。
2. 事务中创建唯一退款记录，把报名改为 `REFUNDING`，并执行 `enrollmentVersion + 1`。
3. 事务提交后发起微信全额退款。
4. 退款成功回调在事务中把退款改为 `SUCCESS`、报名改为 `CANCELLED`、`enrollmentVersion + 1`，此时才释放名额。
5. 退款失败时退款和报名进入失败状态，继续占名额；管理员重试同一 `outRefundNo`。

### 7.6 最低人数、自动取消与完成

1. 报名截止为 `startAt - 1 小时`。
2. 维护任务在截止再加 3 分钟后处理，先结算所有截止前开始的占位。
3. 聚合 `PAID` 报名数，并用 `enrollmentVersion` 验证聚合期间没有报名状态变化。
4. 达到 `minParticipants` 时把课程从 `PUBLISHED` 改为 `CONFIRMED`。
5. 未达到时以 `MIN_PARTICIPANTS_NOT_MET` 原因整体取消，释放受管理场地并为全部已支付报名创建退款。
6. `endAt` 到达后把 `CONFIRMED` 课程改为 `COMPLETED`。
7. 管理员仍可把 `COMPLETED` 课程整体取消并退款。

### 7.7 管理员整体取消

1. 条件更新课程为 `CANCELLED`，保存管理员、时间和原因，立即阻止新报名。
2. 删除或释放同时匹配 `source_type=GROUP_COURSE` 和 `group_course_id` 的占场记录；不得只按时间或 `court_id` 删除。
3. 把未支付占位改为失效；对已支付报名创建全额退款。
4. 已经处于退款流程的报名复用现有退款记录。
5. 课程取消不等待退款全部完成；管理员详情聚合展示退款状态和失败项。

## 8. 定时维护

`group_course_maintenance/config.json` 配置每分钟触发：

```json
{
  "triggers": [
    {
      "name": "group_course_maintenance_every_minute",
      "type": "timer",
      "config": "0 * * * * * *"
    }
  ]
}
```

每次分批处理，单批默认 50 条：

1. 扫描并结算超过 3 分钟的 `PENDING_PAYMENT`。
2. 扫描到达报名判断时间的 `PUBLISHED` 课程，成班或自动取消。
3. 扫描已结束的 `CONFIRMED` 课程并标记完成。
4. 扫描到达 `nextRetryAt` 的失败退款并重试。

列表、详情和报名入口可以针对当前课程顺带执行轻量过期清理，作为定时触发器未部署或延迟时的兜底。所有处理必须使用条件状态更新和幂等键，允许定时任务重复执行。

## 9. 错误处理与一致性

- 云数据库事务只包含数据库读写；微信会员查询、统一下单、主动查单和退款调用均在事务外完成。
- 外部调用前先建立本地状态，调用失败后通过补偿事务或维护任务收敛。
- 所有支付和退款回调重复到达均返回成功，但只有符合前置状态的第一次调用能改变业务状态。
- `enrollmentVersion` 在每次报名状态变化时递增，使容量、最低人数和展示聚合能够检测陈旧快照。它不等于参与人数，也不与人数上限比较。
- 退款成功前不释放名额；退款失败不会恢复课程，也不会物理删除报名。
- 日志记录课程、报名、支付、退款 ID 和状态变化；手机号脱敏，不记录支付参数、数据库密码等敏感数据。

## 10. 代码级测试

本期只做代码级自动测试，不连接测试数据库或真实微信支付。

- 规则测试：VIP 八折抹零、1 小时报名截止、6 小时取消截止、2 分钟付款、3 分钟占位、半小时时段和时间重叠。
- 状态机测试：课程、报名、支付和退款的合法与非法流转。
- 仓储契约测试：使用内存假仓储校验集合名、查询条件、索引字段和权限返回字段。
- 并发模拟：两个用户读取相同版本和人数后抢最后一个名额；验证只有一个事务成功，失败方重新聚合后返回满员。
- 幂等测试：重复支付回调、退款回调、占位清理、整体取消和定时任务。
- 补偿测试：微信下单失败、主动查单失败、退款失败和退款重试。
- 可见性测试：公开列表排除草稿和取消课程；“我的团课”保留个人已取消记录；管理员返回额外字段。
- 配置静态测试：Cron、支付回调名称、退款回调名称和索引清单。

时间、数据库、事务、会员查询和微信支付均通过可注入接口提供，测试使用固定时钟和假实现。

## 11. 部署顺序

1. 检查并清理 `court_order_collection` 中重复的 `(campus, court_id)`。
2. 创建 `campus`、`group_course`、`group_course_enrollment`、`group_course_payment`、`group_course_refund` 集合及本设计列出的全部索引。
3. 为 CloudBase `coach` 集合补充团课所需的名称、介绍和启用字段。
4. 部署支付和退款回调，再部署 `group_course`。
5. 部署 `group_course_maintenance` 并单独上传、启用定时触发器。
6. 发布小程序共享列表、详情和草稿表单页面。
7. 在云函数日志中确认定时触发、支付回调、退款回调和状态流转；线上真实链路验证属于部署验收，不属于自动测试。

回滚应用版本时保留所有团课、报名、支付和退款数据，不删除集合或历史记录。已发起的退款继续由回调和维护任务收敛。
