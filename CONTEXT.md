# Court Book

Court Book is a WeChat Mini Program for tennis court booking and member account operations. This context defines the domain language used by the booking and member-account features.

## Language

**会员账户**:
An external membership record stored in the MySQL `prepaid_card` table.
_Avoid_: 用户信息, 小程序用户

**账户管理员**:
A mini program administrator who may search member accounts. The permission is represented by `accountManager=1` on the administrator record.
_Avoid_: 特殊管理员, 普通管理员
