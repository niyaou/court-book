# Court Book

Court Book is a WeChat Mini Program for tennis court booking and member account operations. This context defines the domain language used by the booking and member-account features.

## Language

**会员账户**:
An external membership record stored in the MySQL `prepaid_card` table.
_Avoid_: 用户信息, 小程序用户

**账户管理员**:
A mini program administrator who may search member accounts. The permission is represented by `accountManager=1` on the administrator record.
_Avoid_: 特殊管理员, 普通管理员

**充值待办**:
教练向管理员报告某位会员发生了充值相关事项，等待管理员知悉的信息。它既不是课程，也不代表会员已经完成真实充值。
_Avoid_: 充值课程, 充值课, 已充值

**充值日期**:
充值待办所属的北京时间业务日期。同一教练、同一会员在同一个充值日期只有一条充值待办。
_Avoid_: 课程日期, 上报时间

**上报时间**:
教练创建或最近一次修改充值待办的北京时间。它用于同一业务日期内的先后排序，不等同于充值日期。

**已知悉**:
管理员已经看过当前版本的充值待办。它不表示管理员认可该事项，也不表示真实充值已经执行。
_Avoid_: 已审核, 已录取, 已充值


**团课授课人员**：
团课从 CloudBase `manager` 复用人员资料，不另建 `coach` 集合；与旧教练填报所读取的 MySQL `coach` 是不同用途。团课不向 MySQL 正式课程或课耗写入记录。

**团课场地**：
优先使用 CloudBase `court._id` 和 `court.campus`；仅在bookingManaged=false且无court记录时，由服务端提供1号场、2号场逻辑标识，不创建court，按校区和编号检查冲突；不要使用 MySQL `court.id`。CloudBase `campus` 管理团课校区启用与是否联动订场占用。

**团课VIP实付金额**：
创建时手填`vipPriceYuan`，原价与VIP均为至少1元的整数，VIP不高于原价，不默认八折。报名按课程金额与实时会员资格保存金额快照，支付退款沿用快照。2026-09-06用户确认尚无已发布课程，无需兼容旧价格。
