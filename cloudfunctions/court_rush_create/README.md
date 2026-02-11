# court_rush_create 云函数说明

## 职责

- 管理员创建一场畅打。
- 校验畅打权限（`courtRushManager=1` 或 `specialManager=1`）。
- 根据传入的 `court_ids` 检查场地冲突，只把 `locked` / `booked` 视为冲突。
- 将本次涉及的场地全部写入 / 更新为 `booked`，标记来源为畅打。
- 在 `court_rush` 集合中插入一条主记录。

## 入参（event）

- `phoneNumber`：管理员手机号，必填。
- `campus`：校区，必填。
- `max_participants`：最大报名人数，必填。
- `base_price_per_person_yuan`：基础每人价格（元），必填。
- `court_ids`：字符串数组，必填，每个元素形如 `2号_20250518_08:00`。
  - 约定格式：`{courtNumber}_{date}_{start_time}`。
  - `date`：`YYYYMMDD`，例如 `20250518`。
  - `start_time`：`HH:mm`，例如 `08:00`、`19:00`。

## 返回结果

- 成功：
  - `success: true`
  - `rushId`: 本次创建的畅打主键 `_id`。
  - `court_ids`: 实际使用的去重后的 `court_id` 列表。
  - `price_per_person_yuan`: 最终每人价格（整数）。
- 失败：
  - `success: false`
  - `error`: 错误代码（`INVALID_PARAMS` / `NO_PERMISSION` / `INVALID_COURT_ID` / `COURT_CONFLICT` / `PRICE_CALC_FAILED` / `CREATE_RUSH_FAILED` 等）。
  - `message`: 中文错误说明。
  - `details`: 可选，内部错误信息。

## 价格与灯光费规则

- 前端传入 `base_price_per_person_yuan` 作为基础每人价格。
- 函数内部根据 `court_ids` 解析开始时间：
  - 对每个 `court_id` 拆分出 `start_time`，规则：`const [courtNumber, date, start_time] = court_id.split('_')`。
  - 若 `start_time >= '18:30'`，视为“18:30 以后”的时段。
- 灯光费计算：
  - 统计满足 `start_time >= '18:30'` 的 `court_id` 数量，记为 `N`。
  - 总灯光费：`N * 10` 元。
  - 每人分摊灯光费：`(N * 10) / 2`。
- 最终每人价格：
  - `final_price_per_person = Math.ceil(base_price_per_person_yuan + (N * 10) / 2)`。
  - 写入 `court_rush.price_per_person_yuan`，只存这个整数价。

## 写入 court_order_collection 的规则

- 先按 `campus` + `court_id in court_ids` 查询已有的场地记录。
- 若存在记录且 `status` 为 `locked` / `booked`，直接视为冲突并返回错误，不做任何写入。
- 否则：
  - 已存在记录：
    - 仅更新字段：
      - `status: 'booked'`
      - `booked_by: rushId`
      - `source_type: 'COURT_RUSH'`
      - `updated_at: now`
    - 保留原有 `created_at`、`price` 等字段。
  - 不存在记录：
    - 新增一条记录，字段包含：
      - `court_id`、`campus`、`courtNumber`、`date`、`start_time`。
      - `end_time`: 当前实现置为 `null`，如后续有统一时长规则可再补充。
      - `status: 'booked'`
      - `price: null`（本函数不负责场地价格计算）。
      - `booked_by: rushId`
      - `source_type: 'COURT_RUSH'`
      - `version: 1`
      - `created_at`、`updated_at`：当前时间。

## 写入 court_rush 的字段

- `_id`: `rushId`，由 `phoneNumber + court_ids + 时间` 生成的 32 位 MD5。
- `court_ids`: 去重后的 `court_id` 列表。
- `campus`
- `max_participants`
- `current_participants`: 初始为 `0`。
- `held_participants`: 初始为 `0`。
- `price_per_person_yuan`: 计算得到的最终每人价格（整数）。
- `status`: `'OPEN'`。
- `created_by`: 管理员手机号。
- `start_at`: 所有时段中最早的开始时间。
- `end_at`: 所有时段中最晚的开始时间（当前仅使用开始时间，后续如需可引入结束时间）。
- `created_at`: `db.serverDate()`。
- `updated_at`: `db.serverDate()`。

## 函数整体流程

1. 校验入参是否齐全，特别是 `phoneNumber`、`campus`、`max_participants`、`base_price_per_person_yuan`、`court_ids`。
2. 查询 `manager` 集合，校验管理员权限（`courtRushManager=1` 或 `specialManager=1`）。
3. 解析 `court_ids`，拆出 `courtNumber`、`date`、`start_time`，计算：
   - 最早/最晚开始时间（`start_at` / `end_at`）。
   - 满足 `start_time >= '18:30'` 的数量，用于灯光费与最终每人价格计算。
4. 生成 `rushId`，作为 `court_rush._id` 与 `court_order_collection.booked_by` 的关联键。
5. 在 `court_order_collection` 中检查冲突：
   - 查询 `campus` + `court_id in court_ids`。
   - 若存在 `status` 为 `locked` / `booked` 的记录，则返回冲突错误。
6. 对所有场地写入 / 更新：
   - 已存在记录：只更新状态和来源为畅打。
   - 不存在记录：插入新的 `booked` 记录。
7. 向 `court_rush` 集合插入主记录。
8. 返回成功结果，包括 `rushId`、实际使用的 `court_ids` 以及最终每人价格。

