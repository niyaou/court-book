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
- `price_per_person_yuan`：四人畅打的基础每人价格（元）；双人畅打使用固定价格。
- `court_ids`：字符串数组，必填，每个元素形如 `2号_20250518_08:00`。
  - 约定格式：`{courtNumber}_{date}_{start_time}`。
  - `date`：`YYYYMMDD`，例如 `20250518`。
  - `start_time`：`HH:mm`，例如 `08:00`、`19:00`。

## 返回结果

- 成功：
  - `success: true`
  - `rushId`: 本次创建的畅打主键 `_id`。
  - `court_ids`: 实际使用的去重后的 `court_id` 列表。
  - `lighting_fee_yuan`: 四人畅打每人的灯光费；双人畅打为 0。
  - `lighting_fee_total_yuan`: 全部所选时段的场地灯光费合计。
  - `lighting_rule_snapshot`: 创建时使用的灯光费规则快照。
- 失败：
  - `success: false`
  - `error`: 错误代码（`INVALID_PARAMS` / `NO_PERMISSION` / `INVALID_COURT_ID` / `COURT_CONFLICT` / `PRICE_CALC_FAILED` / `CREATE_RUSH_FAILED` 等）。
  - `message`: 中文错误说明。
  - `details`: 可选，内部错误信息。

## 价格与灯光费规则

- 根据 `court_ids` 解析预约日期和开始时间，并先调用 `booking_pricing`。
- `booking_pricing` 按预约日期读取 `booking_pricing_rules`，返回每个时段的灯光费及规则快照。
- 四人畅打的每人灯光费为 `Math.ceil(场地灯光费合计 / 4)`；报名时在籍会员的场地基础价仍享五折，灯光费不打折。
- 双人畅打使用固定价，`lighting_fee_yuan` 为 0，表示灯光费已包含在固定价格中。
- 配置读取失败时直接终止创建，不写入场地占用。
- 活动创建后保存灯光费金额和规则快照，后续新增季节规则不会重算已有活动。

## 写入 court_order_collection 的规则

- 先按 `campus` + `court_id in court_ids` 查询已有的场地记录。
- 若存在记录且 `status` 为 `locked` / `booked`，直接视为冲突并返回错误，不做任何写入。
- 否则：
  - 已存在记录：
    - 仅更新字段：
      - `status: 'booked'`
      - `booked_by`: 创建者手机号。
      - `rush_id`: `rushId`。
      - `source_type: 'COURT_RUSH'`
      - `updated_at: now`
    - 保留原有 `created_at`、`price` 等字段。
  - 不存在记录：
    - 新增一条记录，字段包含：
      - `court_id`、`campus`、`courtNumber`、`date`、`start_time`。
      - `end_time`: 开始时间后 30 分钟。
      - `status: 'booked'`
      - `price: null`（本函数不负责场地价格计算）。
      - `booked_by`: 创建者手机号。
      - `rush_id`: `rushId`。
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
- `price_per_person_yuan`: 四人畅打基础每人价；双人畅打为固定非会员价 100 元。
- `lighting_fee_yuan`: 每人灯光费。
- `lighting_fee_total_yuan`: 所有时段的场地灯光费合计。
- `lighting_rule_snapshot`: 创建时的灯光费规则快照。
- `pricing_rule_ids`: 本次使用的计费规则 ID。
- `status`: `'OPEN'`。
- `created_by`: 管理员手机号。
- `start_at`: 所有时段中最早的开始时间。
- `end_at`: 所有时段中最晚的开始时间（当前仅使用开始时间，后续如需可引入结束时间）。
- `created_at`: `db.serverDate()`。
- `updated_at`: `db.serverDate()`。

## 函数整体流程

1. 校验入参是否齐全，特别是 `phoneNumber`、`campus`、`max_participants`、`price_per_person_yuan`、`court_ids`。
2. 查询 `manager` 集合，校验管理员权限（`courtRushManager=1` 或 `specialManager=1`）。
3. 解析 `court_ids` 并调用 `booking_pricing`；配置异常立即结束，不占用场地。
4. 生成 `rushId`，作为 `court_rush._id` 与 `court_order_collection.rush_id` 的关联键。
5. 在 `court_order_collection` 中检查冲突：
   - 查询 `campus` + `court_id in court_ids`。
   - 若存在 `status` 为 `locked` / `booked` 的记录，则返回冲突错误。
6. 对所有场地写入 / 更新：
   - 已存在记录：只更新状态和来源为畅打。
   - 不存在记录：插入新的 `booked` 记录。
7. 向 `court_rush` 集合插入主记录。
8. 返回成功结果，包括 `rushId`、实际使用的 `court_ids`、灯光费和规则快照。
