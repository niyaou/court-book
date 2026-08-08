# 教练填报、课程录取与充值知悉：跨项目联调说明

适用分支：三个仓库的 `course-record`。本文件是联调执行清单；需求以《教练小程序录课与管理员录取_最终需求共识文档_v2.1》为准，接口与实现细节以《教练小程序录课与管理员录取_详细设计文档_v1.0_文件库版》为准。

## 1. 联调范围与职责

- `ledong-db`：维护 `pending_course` 与独立 `coach_recharge_notice` 表，提供管理员统一待处理列表、课程录取、充值历史和知悉接口；只有课程录取会调用既有 `CourseService.CreateCourse`。
- `ledong-tennis/material-kit-react`：提供“教练填报”管理页，混合展示待审课程与待知悉充值，并提供已知悉充值历史。
- `court-book`：教练身份初始化、待审课程 CRUD、充值待办 CRUD、会员搜索、正式课程及已知悉充值查询；云函数直接连接 MySQL，不调用 `ledong-db` 的新接口。

主流程：教练小程序提交待审课 → `pending_course` → 管理端查询 → 管理员逐条录取 → 既有正式录课逻辑创建 `course`、`spend`、`course_member` 并扣减余额/次数 → 物理删除待审记录。

充值流程：教练小程序提交充值待办 → `coach_recharge_notice` → 管理端统一时间流 → 管理员按内容版本知悉 → 已知悉历史。充值待办及其知悉过程不得写入 `charge`、`course`、`spend` 或 `course_member`；“已知悉”不表示“已充值”。

兼容边界：旧 Excel 页面、旧 duplicate 接口、旧 `POST /api/prepaidCard/course/create` 及其调用方不改动；Excel 与待审课不在同一页面混合。

## 2. 上线前配置

1. 在测试库依次执行 `ledong-db/db-migrate/create_pending_course.sql` 与 `ledong-db/db-migrate/create_coach_recharge_notice.sql`；上线前用 `SHOW CREATE TABLE` 核对两张待办表的字段、唯一键和排序索引。
2. `ledong-db` 运行环境设置 `TZ=Asia/Shanghai`；MySQL `DATETIME`、HTTP 时间字符串和 `updatedAt` 比较均使用业务时间 `YYYY-MM-DD HH:mm:ss`。
3. 为五个云函数 `coach_context`、`pending_course`、`recharge_notice`、`member_search`、`coach_course_list` 配置相同的 `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_DATABASE`。腾讯云函数运行时可为 UTC；新云函数会在每个 MySQL 连接建立后设置并校验 session `time_zone='+08:00'`。
4. 确认微信云函数到 MySQL 的网络白名单、账号权限和 TLS/网络配置可用；`pending_course` 只写待审课程表，`recharge_notice` 只写充值待办表，二者都不得写正式业务表。
5. 管理端沿用现有 Axios `secure` 请求头；测试账号需具备既有管理后台权限。

## 3. 接口与数据契约

### 管理后台 API

- `GET /api/pending-course`：复用 `secure` 鉴权；返回按 `startTime DESC, id DESC` 排序的扁平待审课程 DTO，前端按校区分组。
- `POST /api/pending-course/{id}/admit`：复用 `secure` 鉴权，使用 JSON；请求包含 `updatedAt` 与完整 `course` 数据。成功返回 `{ "id": <formalCourseId> }`。
- `GET /api/coach-submissions?pageNum=1&pageSize=30`：按业务日期、上报时间和 ID 稳定倒序返回 `COURSE` / `RECHARGE_NOTICE` 判别联合类型。
- `GET /api/recharge-notices?status=ACKNOWLEDGED&pageNum=1&pageSize=30&startDate=&endDate=`：查询已知悉充值历史。
- `POST /api/recharge-notices/{id}/acknowledge`：请求 `{ "version": 1 }`；版本过期返回 409，重复知悉保持幂等。

统一分页请求页码从 1 开始，响应 `number` 从 0 开始。`RechargeNoticeDTO` 固定包含 `id`、`coachId`、`coachName`、`coachActive`、`memberId`、`memberName`、`memberNumber`、`memberActive`、`rechargeDate`、`note`、`status`、`version`、`createdAt`、`updatedAt`、`acknowledgedAt`。业务日期使用 `YYYY-MM-DD`，时间使用 `YYYY-MM-DD HH:mm:ss`，前端不得把这些字符串交给 JavaScript `Date` 再做时区换算。

录取请求中的 `course` 至少包含：`coachId`、`courtId`、`startTime`、`endTime`、`duration`、`courseType`、`isAdult`、`description` 和 `membersData`。每个会员消费项使用 `memberId`、`charge`、`times`、`annualTimes`、`description`、`quantities`。

关键错误码：`PENDING_UPDATED`、`PENDING_NOT_FOUND`、`COURSE_DUPLICATE`、`INVALID_MEMBER_SPEND`、`DUPLICATE_MEMBER`、`COACH_NOT_FOUND`、`COURT_NOT_FOUND`、`MEMBER_NOT_FOUND`、`FORMAL_CREATED_PENDING_DELETE_FAILED`、`INTERNAL_ERROR`。管理端统一使用既有 notify 展示，`PENDING_UPDATED` 与 `PENDING_NOT_FOUND` 后刷新列表。

### 小程序云函数

- `coach_context`：初始化教练上下文和校区。
- `pending_course`：`create`、`list`、`update`、`delete`；只读/写 `pending_course`。
- `recharge_notice`：`create`、`list`、`update`、`delete`；只读/写 `coach_recharge_notice`。备注去除首尾空白后长度为 1 到 500；充值日期由北京时间 MySQL 会话的 `CURRENT_DATE()` 生成。修改携带内容版本；修改已知悉记录会增加版本、清空知悉时间并重新变为 `PENDING`，只有 `PENDING` 可以删除。
- `member_search`：姓名模糊搜索，最多 20 条，返回余额字段。
- `coach_course_list`：只读当前教练当前自然月及前两个月的正式课；范围固定按 `Asia/Shanghai`，每页 30 条。响应额外返回不受分页影响的 `currentMonthSummary`，固定统计当前自然月的授课课程数量、总课程时长和等效总人数；授课课程含体验课、班课、私教，不含订场，等效人数沿用效率统计口径。

云函数业务时间也使用 `YYYY-MM-DD HH:mm:ss`。教练提交的 `startTime`、`endTime` 作为中国业务本地字符串直接绑定到 MySQL `DATETIME`，不得先转换为 UTC；待审列表与正式课列表用 `DATE_FORMAT` 返回同一格式。正式课三自然月范围通过 `Intl` 显式按 `Asia/Shanghai` 计算，不能使用云函数运行时本地时区。`course_type` 为 `-2/-1/0/1/2`；订场 `is_adult` 继续沿用正式课程的实际字段值与默认语义。

## 4. 部署顺序

1. 执行数据库迁移并检查表、索引和权限。
2. 部署 `ledong-db`，确认新路由可用且旧 Excel 录课接口仍可用。
3. 安装并部署 `recharge_notice` 等五个云函数依赖，写入配置并在微信环境验证教练身份、MySQL 连接和日志。
4. 发布 `ledong-tennis/material-kit-react` 管理端版本。
5. 发布 `court-book` 小程序版本。

回滚时可回滚后台、管理端或小程序应用版本；保留 `pending_course` 表及未消费记录，不删除待审数据。
回滚时同样保留 `coach_recharge_notice` 及历史记录，不把充值待办迁入正式充值表。

## 5. 联调验收清单

### 核心闭环

1. 教练使用小程序新增班课（多人、不同扣费类型）后，在待审列表看到该课程。
2. 管理端“教练填报课程”页面显示课程，按校区分组；展开会员明细、欠费确认、手动刷新均正常。
3. 管理员录取后，确认正式课程可见，`spend` 与 `course_member` 已写入，余额/次数按既有逻辑扣减，待审记录被物理删除。
4. 管理端立即刷新后不再显示已录取课程；小程序待审页刷新后也不再显示该课程。
5. 教练选择“用户充值”，选定单个会员并填写备注；提交后小程序与管理端待处理时间流均可见，且四张正式业务表没有新增记录。
6. 管理员知悉后记录进入双方已知悉历史；教练修改该历史记录后，版本增加且记录重新进入待处理。

### 异常与边界

1. 管理员加载待审课后，教练修改该课程；录取应返回 `PENDING_UPDATED`，不创建正式课。
2. 教练编辑页中的待审课已被录取/删除；保存或删除应返回 `PENDING_NOT_FOUND`，小程序提示后退出或移除本地卡片。
3. 检查体验课、订场、班课、私教；特别验证订场 `isAdult` 与既有正式录课保持一致。
4. 验证课时费为 0、次卡/年卡最小 0.5、重复会员拒绝、无效会员/校区/教练的错误提示。
5. 在北京时间月初、跨年和二月检查正式课“三自然月”范围；云函数运行时区变化不应改变结果。
6. 同一教练、同一会员、同一北京时间日期重复上报应被拒绝；不同教练或不同日期允许上报。
7. 管理员读取后若教练先修改，旧版本知悉必须冲突；已知悉记录不可删除，待知悉记录可删除。
8. 分别模拟待审课或充值待办加载失败，另一类已成功加载的记录必须保留，页面不能显示虚假的空状态。

### 旧功能回归

1. 使用旧 Excel 自动录课完成一次创建，确认旧页面、FormData、duplicate 与既有正式课程创建接口保持可用。
2. 检查管理端首页、会员、统计、自动录课菜单与鉴权正常。
3. 检查小程序既有登录、会员中心、订场和旧云函数不受影响。

## 6. 已确认业务边界

- 当前按单管理员操作假设联调，不额外处理同一待审课的管理员并发录取。
- 小程序通过 `coach_context` 取得教练资料，并在后续请求中传递 `coachId`；本期不额外增加请求签名或 token 防护方案。
- 待审课程仍不处理小程序重复并发提交冲突；充值待办由数据库唯一键和内容版本处理重复及并发修改。
- 不增加消息通知、批量填报、批量录取、动态 TabBar 或旧 Excel 页面重构。
- 本期不执行真实充值、不记录金额或次数，也不记录具体知悉管理员身份。

## 7. 联调记录

每次联调请记录：环境、三仓库 `course-record` 提交 SHA、迁移版本、云函数版本与配置校验结果、测试账号、步骤、实际结果、SQL/应用日志位置和阻塞项。不要在用户提示、前端日志或本文件中写入数据库密码或手机号等敏感信息。
