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

## 教学详情排版（2026-10-13）

本次仅更新小程序前端，不改云函数、数据库字段、集合或索引，也无需数据迁移。教学详情使用原生 editor，支持小标题、加粗、斜体、下划线、列表与对齐；管理员修改的是本次课程快照，不回写模板，发布后仍不可修改。

前端 `utils/groupCourseContent.js` 将编辑器的文字及支持的格式转换为带内联样式的 HTML 字符串，保存在原有 `description` 字段中。字符串以 `<!--group-course-rich-text:v1-->` 标记开头，详情和发布预览据此使用 rich-text 渲染；没有标记的旧内容按纯文字显示，保留换行、空行、空格，已有文字中的 HTML 标签不作为排版解析。模板也沿用同一字段，编辑器按内容类型加载 HTML 或纯文字。

Delta 仅在前端编辑期间使用，不作为接口字段提交或存入数据库。前端发布时生成允许的标签与样式，转义文字中的 HTML 特殊字符，不提交编辑器提供的任意 HTML，也不支持图片等嵌入内容。生成后的完整 description（含 HTML）仍须在原接口 20000 字符限制内，超过时在发布前提示精简。原后端直接保存及返回字符串，排版变化自然参与原有发布幂等校验；待核实请求保留确认时的字符串和请求号，不重新编码。

数据库普通字段编辑器可能将手动输入的 `\n` 保存为字面字符。前端对没有富文本标记的 description 兼容字面 `\n`、`\r\n`、`\r`，读取详情和回填模板时均转换为真实换行；连续两个 `\n` 保留空行。不会解析其他 JSON 转义，也不会改写数据库或待重试请求。

上线只需发布小程序。自动化测试覆盖现有后端原样保存与返回 HTML、旧课程显示、模板加载、特殊字符转义、总长度限制和网络失败重试。微信真机预览仍需验证选中文字后应用样式、键盘与工具栏交互、HTML 模板回填，以及发布后重进详情的显示效果。
