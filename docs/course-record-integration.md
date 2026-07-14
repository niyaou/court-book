# 教练录课与管理员录取：跨项目联调说明

适用分支：三个仓库的 `course-record`。本文件是联调执行清单；需求以《教练小程序录课与管理员录取_最终需求共识文档_v2.1》为准，接口与实现细节以《教练小程序录课与管理员录取_详细设计文档_v1.0_文件库版》为准。

## 1. 联调范围与职责

- `ledong-db`：创建 `pending_course` 表，提供管理员待审列表与录取接口；录取时适配并调用既有 `CourseService.CreateCourse`。
- `ledong-tennis/material-kit-react`：提供“教练填报课程”管理页，按校区分组展示待审课并逐条录取。
- `court-book`：教练身份初始化、待审课程 CRUD、会员搜索、正式课程只读查询；云函数直接连接 MySQL，不调用 `ledong-db` 的新接口。

主流程：教练小程序提交待审课 → `pending_course` → 管理端查询 → 管理员逐条录取 → 既有正式录课逻辑创建 `course`、`spend`、`course_member` 并扣减余额/次数 → 物理删除待审记录。

兼容边界：旧 Excel 页面、旧 duplicate 接口、旧 `POST /api/prepaidCard/course/create` 及其调用方不改动；Excel 与待审课不在同一页面混合。

## 2. 上线前配置

1. 在测试库执行 `ledong-db/db-migrate/create_pending_course.sql`；上线前用 `SHOW CREATE TABLE` 核对 `course`、`coach`、`court`、`prepaid_card`、`spend` 的实际字段。
2. `ledong-db` 运行环境设置 `TZ=Asia/Shanghai`；MySQL `DATETIME`、HTTP 时间字符串和 `updatedAt` 比较均使用业务时间 `YYYY-MM-DD HH:mm:ss`。
3. 为四个新云函数 `coach_context`、`pending_course`、`member_search`、`coach_course_list` 配置相同的 `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_DATABASE`。腾讯云函数运行时可为 UTC；新云函数会在每个 MySQL 连接建立后设置并校验 session `time_zone='+08:00'`。
4. 确认微信云函数到 MySQL 的网络白名单、账号权限和 TLS/网络配置可用；云函数只允许写 `pending_course`，不写正式业务表。
5. 管理端沿用现有 Axios `secure` 请求头；测试账号需具备既有管理后台权限。

## 3. 接口与数据契约

### 管理后台 API

- `GET /api/pending-course`：复用 `secure` 鉴权；返回按 `startTime DESC, id DESC` 排序的扁平待审课程 DTO，前端按校区分组。
- `POST /api/pending-course/{id}/admit`：复用 `secure` 鉴权，使用 JSON；请求包含 `updatedAt` 与完整 `course` 数据。成功返回 `{ "id": <formalCourseId> }`。

录取请求中的 `course` 至少包含：`coachId`、`courtId`、`startTime`、`endTime`、`duration`、`courseType`、`isAdult`、`description` 和 `membersData`。每个会员消费项使用 `memberId`、`charge`、`times`、`annualTimes`、`description`、`quantities`。

关键错误码：`PENDING_UPDATED`、`PENDING_NOT_FOUND`、`COURSE_DUPLICATE`、`INVALID_MEMBER_SPEND`、`DUPLICATE_MEMBER`、`COACH_NOT_FOUND`、`COURT_NOT_FOUND`、`MEMBER_NOT_FOUND`、`FORMAL_CREATED_PENDING_DELETE_FAILED`、`INTERNAL_ERROR`。管理端统一使用既有 notify 展示，`PENDING_UPDATED` 与 `PENDING_NOT_FOUND` 后刷新列表。

### 小程序云函数

- `coach_context`：初始化教练上下文和校区。
- `pending_course`：`create`、`list`、`update`、`delete`；只读/写 `pending_course`。
- `member_search`：姓名模糊搜索，最多 20 条，返回余额字段。
- `coach_course_list`：只读当前教练当前自然月及前两个月的正式课；范围固定按 `Asia/Shanghai`，每页 30 条。

云函数业务时间也使用 `YYYY-MM-DD HH:mm:ss`。教练提交的 `startTime`、`endTime` 作为中国业务本地字符串直接绑定到 MySQL `DATETIME`，不得先转换为 UTC；待审列表与正式课列表用 `DATE_FORMAT` 返回同一格式。正式课三自然月范围通过 `Intl` 显式按 `Asia/Shanghai` 计算，不能使用云函数运行时本地时区。`course_type` 为 `-2/-1/0/1/2`；订场 `is_adult` 继续沿用正式课程的实际字段值与默认语义。

## 4. 部署顺序

1. 执行数据库迁移并检查表、索引和权限。
2. 部署 `ledong-db`，确认新路由可用且旧 Excel 录课接口仍可用。
3. 分别安装并部署四个云函数依赖，写入配置并在微信环境验证教练身份、MySQL 连接和日志。
4. 发布 `court-book` 小程序版本。
5. 发布 `ledong-tennis/material-kit-react` 管理端版本。

回滚时可回滚后台、管理端或小程序应用版本；保留 `pending_course` 表及未消费记录，不删除待审数据。

## 5. 联调验收清单

### 核心闭环

1. 教练使用小程序新增班课（多人、不同扣费类型）后，在待审列表看到该课程。
2. 管理端“教练填报课程”页面显示课程，按校区分组；展开会员明细、欠费确认、手动刷新均正常。
3. 管理员录取后，确认正式课程可见，`spend` 与 `course_member` 已写入，余额/次数按既有逻辑扣减，待审记录被物理删除。
4. 管理端立即刷新后不再显示已录取课程；小程序待审页刷新后也不再显示该课程。

### 异常与边界

1. 管理员加载待审课后，教练修改该课程；录取应返回 `PENDING_UPDATED`，不创建正式课。
2. 教练编辑页中的待审课已被录取/删除；保存或删除应返回 `PENDING_NOT_FOUND`，小程序提示后退出或移除本地卡片。
3. 检查体验课、订场、班课、私教；特别验证订场 `isAdult` 与既有正式录课保持一致。
4. 验证课时费为 0、次卡/年卡最小 0.5、重复会员拒绝、无效会员/校区/教练的错误提示。
5. 在北京时间月初、跨年和二月检查正式课“三自然月”范围；云函数运行时区变化不应改变结果。

### 旧功能回归

1. 使用旧 Excel 自动录课完成一次创建，确认旧页面、FormData、duplicate 与既有正式课程创建接口保持可用。
2. 检查管理端首页、会员、统计、自动录课菜单与鉴权正常。
3. 检查小程序既有登录、会员中心、订场和旧云函数不受影响。

## 6. 已确认业务边界

- 当前按单管理员操作假设联调，不额外处理同一待审课的管理员并发录取。
- 小程序通过 `coach_context` 取得教练资料，并在后续请求中传递 `coachId`；本期不额外增加请求签名或 token 防护方案。
- 本期不处理小程序重复并发提交冲突。
- 不增加消息通知、批量填报、批量录取、动态 TabBar 或旧 Excel 页面重构。

## 7. 联调记录

每次联调请记录：环境、三仓库 `course-record` 提交 SHA、迁移版本、云函数版本与配置校验结果、测试账号、步骤、实际结果、SQL/应用日志位置和阻塞项。不要在用户提示、前端日志或本文件中写入数据库密码或手机号等敏感信息。
