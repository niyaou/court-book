# 团课定时任务查询（2026-09-26）

`group_course_maintenance` 保持每分钟触发。任务选取从全量读取后过滤改为数据库条件查询，每个查询最多返回 50 条，不再自动翻页读完整个集合。

| 队列 | 数据库条件 | 排序（均升序） | 单次返回上限 |
|---|---|---|---|
| 待成班 | `status=PUBLISHED`，`startAt <= 当前时间 + 57分钟`，`maintenanceAt` 到期或为空 | `maintenanceAt, _id` | 50 |
| 待结束 | `status=CONFIRMED`，`endAt <= 当前时间`，`maintenanceAt` 到期或为空 | `maintenanceAt, _id` | 50 |
| 待取消清理 | `status=CANCELLED`，`cancellationCleanupCompleted=false`，`maintenanceAt` 到期或为空 | `maintenanceAt, _id` | 50 |
| 待支付补查 | `status=PENDING`，`queryNextAt` 到期或为空 | `queryNextAt, _id` | 50 |
| 待退款处理 | `status` 为 `PENDING/PROCESSING/FAILED`，`nextRetryAt` 非空且到期，`leaseUntil` 到期或为空 | `nextRetryAt, _id` | 50 |
| 待释放占位 | 报名 `status=PENDING_PAYMENT`，`attemptStartedAt <= 当前时间 - 3分钟` | `attemptStartedAt, _id` | 50 |

“为空”兼容字段缺失和显式 `null`。时间比较包含等于边界。退款的 `nextRetryAt` 缺失或为 `null` 表示不自动重试，必须排除。

每次初始选取共 6 次查询，最多返回 300 条候选记录。待成班和待结束合并后最多处理 50 条；其他队列各最多处理 50 条候选。每条候选进入业务处理时，仍可能读取其关联报名、支付、退款记录，因此 300 并非整个调用的总数据库读取上限。

课程和支付按上次保留的处理时间排序，处理前仍通过事务将下次处理时间推进一分钟；失败记录不会持续挤占尚未尝试过的记录。退款仍用现有租约和重试退避。过期占位直接从活跃报名选取，释放后退出队列，不再被历史未决支付挤占。

没有增加“只看最近几天”的下限；很早以前到期但尚未处理的记录仍能被补偿。成班仍统计实际执行时的当前 PAID 人数，支付确认、退款回调假设和客户取消截止规则保持不变。

## 部署索引

下列普通组合索引均按字段顺序升序创建，唯一索引保持原样。清单同步维护于 `cloudfunctions/group_course/deployment.json`。该 JSON 是部署说明，运行构建脚本不会在线创建索引。

| 集合 | 建议名称 | 字段（按顺序） |
|---|---|---|
| `group_course` | `idx_formation_due` | `status, startAt, maintenanceAt, _id` |
| `group_course` | `idx_completion_due` | `status, endAt, maintenanceAt, _id` |
| `group_course` | `idx_cancel_cleanup_due` | `status, cancellationCleanupCompleted, maintenanceAt, _id` |
| `group_course_payment` | `idx_payment_query_due` | `status, queryNextAt, _id` |
| `group_course_refund` | `idx_refund_retry_due` | `status, nextRetryAt, _id, leaseUntil` |
| `group_course_enrollment` | `idx_hold_expiry_due` | `status, attemptStartedAt, _id` |

课程到期查询同时过滤业务时间和轮转时间。业务时间索引缩小到期候选范围，但不保证同时覆盖按轮转时间排序；应在云端检查实际查询计划或慢查询。`limit(50)` 限制返回记录数，不代表数据库内部最多扫描 50 条。

上线时先核对索引，再部署 `group_course_maintenance`。共享代码构建会同步四个团课云函数的 lib 副本，其他云函数可随同版本一起部署。本文不表示已在线创建索引或部署。

验证命令：

```sh
node scripts/build-group-course.js
node --test cloudfunctions/group_course/test/*.test.js tests/group-course-*.test.js
node scripts/build-group-course.js --check
```

回归覆盖无到期任务时零候选返回、50 条批次上限、失败任务轮转、待付款补查轮转、独立释放过期占位、退款租约和暂停状态，以及原有成班、支付和退款规则。
