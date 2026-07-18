# booking_pricing 云函数

统一从 `booking_pricing_rules` 集合解析按预约日期生效的灯光费规则。小程序端不直接读取配置集合；`get_court_order`、`pay_order_create` 和 `court_rush_create` 调用本函数。

## 调用格式

```json
{
  "campus": "麓坊校区",
  "slots": [
    { "date": "20260718", "start_time": "19:00" },
    { "date": "20260718", "start_time": "19:30" }
  ]
}
```

成功时返回每个时段的灯光费、合计金额及所使用的规则快照。找不到规则或规则格式错误时返回失败，调用方必须停止展示价格、创建支付或创建畅打。

## 首次上线配置

部署调用方前，在云开发控制台创建 `booking_pricing_rules` 集合，并导入 [`booking_pricing_rules.seed.json`](./booking_pricing_rules.seed.json)：

- 历史基线：`19700101` 起为 `18:30`、10元/半小时。
- 新规则：`20260718` 起为 `19:30`、10元/半小时。

如果实际上线日期不同，导入前修改第二条记录的 `_id`、`effective_from` 和 `note`。规则按预约日期匹配，不按下单时间匹配。

## 控制台设置

- 创建唯一组合索引：`type` 升序 + `effective_from` 降序。
- 为云函数查询创建组合索引：`type` 升序 + `status` 升序 + `effective_from` 降序。
- 集合权限设置为客户端不可读、不可写：`{ "read": false, "write": false }`。
- 换季时新增一条 `PUBLISHED` 记录，不修改已经生效的历史记录。
- `campus_overrides` 可覆盖某个校区的 `enabled`、`start_time` 或 `fee_per_slot_yuan`。
- 时间必须是 `HH:00` 或 `HH:30`；金额必须是非负且最多两位小数。

## 部署顺序

1. 创建集合、索引和安全规则，导入初始数据。
2. 部署 `booking_pricing` 并用云端测试验证两个边界时段。
3. 部署 `get_court_order`、`pay_order_create`、`court_rush_create`。
4. 发布包含动态提示文案的小程序版本。
