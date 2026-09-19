## 已确认的项目决策：手机号作为业务身份

用户已明确理解并接受以手机号作为身份依据的风险。此决策跨 session、跨对话持续有效，除非用户明确修改。

- 登录状态、管理员权限、会员资格、报名唯一性、本人记录及退款归属统一依据 `phoneNumber`。
- 复用个人中心已有手机号和全局个人资料，与畅打保持一致。资料缺失时走现有个人中心流程。
- 前端管理员入口与管理操作显示统一使用 `manager_permissions` 初始化/刷新后的全局权限列表，按当前手机号匹配；团课接口返回的 `viewer.isAdmin` 不得覆盖该权限来源。服务端业务操作仍按手机号查库校验权限。
- 不自行增加独立登录 token、手机号与 openid 绑定表、重复手机号授权或身份迁移流程。
- `openid` 不参与业务身份判断；支付协议参数及定时任务调用来源识别等技术用途可保留。
- 后续实现、审查和对话直接沿用此决策，不反复要求用户确认风险，不仅因这一已接受取舍而暂停工作或要求重做认证设计。
- 继续按手机号在服务端查询业务权限、会员资格，并执行金额、容量、状态和幂等校验。这些是业务正确性检查，不是重新评估身份方案。
- 本规则记录用户的业务决策，不将客户端不可篡改表述为已核实的平台技术保证，也不改变工具或平台自身的权限机制。

## Skills
A skill is a set of local instructions to follow that is stored in a `SKILL.md` file. Below is the list of skills that can be used. Each entry includes a name, description, and file path so you can open the source for full instructions when using a specific skill.

### Available skills
- frontend-design: Create distinctive, production-grade frontend interfaces (web components, pages, dashboards, React/HTML/CSS). Use when building or beautifying web UI; avoids generic AI aesthetics. (file: C:/Users/Administrator/.cursor/skills/frontend-design/SKILL.md)
- find-skills: Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill. (file: C:/Users/34248/.agents/skills/find-skills/SKILL.md)
- skill-creator: Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends Codex's capabilities with specialized knowledge, workflows, or tool integrations. (file: C:/Users/34248/.codex/skills/.system/skill-creator/SKILL.md)
- skill-installer: Install Codex skills into $CODEX_HOME/skills from a curated list or a GitHub repo path. Use when a user asks to list installable skills, install a curated skill, or install a skill from another repo (including private repos). (file: C:/Users/34248/.codex/skills/.system/skill-installer/SKILL.md)
- auth-wechat-miniprogram: Authentication patterns and implementation guidance for WeChat Mini Program projects. (file: C:/Users/34248/.codex/skills/auth-wechat-miniprogram/SKILL.md)
- cloud-functions: WeChat/CloudBase cloud function development and integration workflow. (file: C:/Users/34248/.codex/skills/cloud-functions/SKILL.md)
- cloudbase-document-database-in-wechat-miniprogram: CloudBase document database usage in WeChat Mini Program scenarios. (file: C:/Users/34248/.codex/skills/cloudbase-document-database-in-wechat-miniprogram/SKILL.md)
- cloudbase-guidelines: CloudBase best practices and guardrails for project delivery. (file: C:/Users/34248/.codex/skills/cloudbase-guidelines/SKILL.md)
- miniprogram-development: End-to-end WeChat Mini Program development workflow and implementation guidance. (file: C:/Users/34248/.codex/skills/miniprogram-development/SKILL.md)

### How to use skills
- Discovery: The list above is the skills available in this session (name + description + file path). Skill bodies live on disk at the listed paths.
- Trigger rules: If the user names a skill (with `$SkillName` or plain text) OR the task clearly matches a skill's description shown above, you must use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.
- Missing/blocked: If a named skill isn't in the list or the path can't be read, say so briefly and continue with the best fallback.
- How to use a skill (progressive disclosure):
  1) After deciding to use a skill, open its `SKILL.md`. Read only enough to follow the workflow.
  2) When `SKILL.md` references relative paths (e.g., `scripts/foo.py`), resolve them relative to the skill directory listed above first, and only consider other paths if needed.
  3) If `SKILL.md` points to extra folders such as `references/`, load only the specific files needed for the request; don't bulk-load everything.
  4) If `scripts/` exist, prefer running or patching them instead of retyping large code blocks.
  5) If `assets/` or templates exist, reuse them instead of recreating from scratch.
- Coordination and sequencing:
  - If multiple skills apply, choose the minimal set that covers the request and state the order you'll use them.
  - Announce which skill(s) you're using and why (one short line). If you skip an obvious skill, say why.
- Context hygiene:
  - Keep context small: summarize long sections instead of pasting them; only load extra files when needed.
  - Avoid deep reference-chasing: prefer opening only files directly linked from `SKILL.md` unless you're blocked.
  - When variants exist (frameworks, providers, domains), pick only the relevant reference file(s) and note that choice.
- Safety and fallback: If a skill can't be applied cleanly (missing files, unclear instructions), state the issue, pick the next-best approach, and continue.


## 团课数据源规则

- 团课教练资料复用 CloudBase `manager`，禁止重新引入独立 CloudBase `coach` 集合。
- 团课场地使用 CloudBase `court`；MySQL 同名 court/coach 仅属于原有教练与课耗模块，不能混用主键。
- 团课对 MySQL 的依赖仅为只读 prepaid_card 的 VIP 判断，不写正式课程、会员课耗。
- 新增团课集合只有 campus、group_course_template、group_course、group_course_enrollment、group_course_payment、group_course_refund；已有集合无需重复创建。

- 团课 VIP 复用已有 club_member 云函数及订场会员资格公式；只在价格展示和报名时查询，创建/取消不查询。付款以服务端报名金额快照为准；不再为团课配置独立 MySQL 连接。

- 团课支付沿用订场、畅打的代码配置方式：商户号与回调云环境集中维护于 cloudfunctions/group_course/lib/paymentConfig.js，通过构建同步四个团课云函数，不要求支付环境变量。

## 团课价格与默认场地决策（2026-09-06）

- VIP直接手填`vipPriceYuan`，不使用默认八折或自动折扣；原价与VIP均为至少1元的整数，VIP不高于原价。用户确认尚无已发布课程，无需旧价格兼容。
- 仅当`bookingManaged=false`且校区没有任何CloudBase `court`记录时，由服务端提供1号场、2号场固定逻辑标识，不创建court记录；有真实场地则只使用真实列表。
- 发布时重新校验默认标识和校区条件；同校区、同场地编号继续参与团课冲突判断，不写订场占用。

## 团课退款完成判定的已确认假设（2026-09-19）

用户明确要求沿用原有退款回调的处理方式，并接受以下业务假设，后续直接沿用，除非用户修改决策：

- 收到可关联到现有退款记录的退款回调，就按退款完成处理，不再主动查询或要求回调提供退款成功状态。支持退款单号定位；未传退款单号时支持支付订单号定位。有支付订单号时必须与本地支付记录一致，未知记录不创建退款。
- 补查的 returnCode、resultCode 均为 SUCCESS，outTradeNo 与本地支付订单一致，且 refundCount 为 1（含字符串 "1"），就按退款完成处理，不依赖明细数组、退款金额或明细状态。其他返回仍走原有解析或补查逻辑。
- 这些是业务接受的推定条件，不是平台保证：收到回调或退款数量为 1 本身不证明资金到账；本规则可能将处理中或异常退款提前记为完成。
- 推定完成使用现有事务及幂等路径：退款 SUCCESS、对应当前支付的报名 CANCELLED、更新课程人数、停止补查；支付记录保留 PAIDED。不改订场或畅打实现。
- 退款记录 confirmationBasis 区分 CALLBACK_RECEIVED、REFUND_COUNT_ONE、QUERY_STATUS_SUCCESS；前两种 channelStatus 记 UNKNOWN，避免伪称微信返回了 SUCCESS。
