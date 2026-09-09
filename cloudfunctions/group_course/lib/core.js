"use strict";
const crypto = require("crypto");
const MINUTE = 60000;
const C = {
  course: "group_course",
  enrollment: "group_course_enrollment",
  payment: "group_course_payment",
  refund: "group_course_refund",
  slot: "court_order_collection",
};
const ms = (v) =>
  v == null ? null : v instanceof Date ? v.getTime() : Number(v);
const hash = (...parts) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 32);
const random = () => crypto.randomBytes(16).toString("hex");
const messages = {
  AUTH_REQUIRED: "请先在个人中心登录",
  FORBIDDEN: "没有操作权限",
  COURSE_NOT_FOUND: "课程不存在或不可见",
  INVALID_ARGUMENT: "请检查填写的信息",
  BASE_DATA_UNAVAILABLE: "基础资料暂不可用",
  TEMPLATE_UNAVAILABLE: "所选教学模板不可用",
  COACH_UNAVAILABLE: "所选教练不可用",
  CAMPUS_UNAVAILABLE: "所选校区不可用",
  COURT_UNAVAILABLE: "所选场地不可用",
  PUBLISH_TOO_LATE: "已过报名截止时间，请调整开课时间",
  INVALID_TIME_RANGE: "请选择同一天内连续的半小时时段",
  INVALID_PRICE: "原价和VIP实付金额须为至少1元的整数，VIP金额不得高于原价",
  INVALID_PARTICIPANTS: "请检查最低人数和人数上限",
  COURT_CONFLICT: "所选场地时段已被占用",
  COACH_CONFLICT: "教练在所选时段已有课程",
  REQUEST_ID_CONFLICT: "发布内容与原请求不一致，请核实原发布结果",
  ENROLLMENT_CLOSED: "报名已截止",
  COURSE_FULL: "名额已满",
  ALREADY_ENROLLED: "你已报名或正在退款中",
  CANCEL_WINDOW_CLOSED: "已超过可取消时间",
  ENROLLMENT_NOT_FOUND: "没有可操作的报名记录",
  VIP_UNAVAILABLE: "会员资格暂时无法查询，请稍后重试",
  PAYMENT_UNAVAILABLE: "支付暂时不可用，请稍后重试",
  PAYMENT_PENDING: "支付结果正在确认中",
  RETRYABLE_CONFLICT: "操作冲突，请稍后重试",
  CONFIG_ERROR: "服务配置未完成，请联系管理员",
};
class BusinessError extends Error {
  constructor(code, message = code, retryable = false, details) {
    super(messages[code] || message);
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}
const fail = (code, retryable = false, details) => {
  throw new BusinessError(code, code, retryable, details);
};
const date = (n) => new Date(n);
// Logical resources for unmanaged campuses with no configured court documents.
function campusCourts(campus, courts) {
  const configured = courts.filter((court) => court.campus === campus.name);
  if (configured.length || campus.bookingManaged !== false) return configured;
  return ["1", "2"].map((courtNumber) => ({
    _id: `group_course_default_${hash(campus.name, courtNumber)}`,
    campus: campus.name,
    courtNumber,
  }));
}
const fee = (price, vip, vipPrice) => {
  const amount = vip ? vipPrice : price;
  if (!Number.isSafeInteger(amount) || amount < 1 || !Number.isSafeInteger(amount * 100))
    fail("INVALID_PRICE");
  return amount;
};
const occupied = (e, now) =>
  ["PAID", "REFUNDING", "REFUND_FAILED"].includes(e.status) ||
  (e.status === "PENDING_PAYMENT" && ms(e.attemptStartedAt) + 3 * MINUTE > now);
const deadlines = (c) => ({
  enrollmentDeadlineAt: ms(c.startAt) - 60 * MINUTE,
  formationAt: ms(c.startAt) - 57 * MINUTE,
  cancelDeadlineAt: ms(c.startAt) - 360 * MINUTE,
});
function beijing(n) {
  const d = new Date(n + 8 * 60 * MINUTE);
  return {
    day: d.toISOString().slice(0, 10).replace(/-/g, ""),
    time: d.toISOString().slice(11, 16),
    stamp: d.toISOString().replace(/[-:T]/g, "").slice(0, 14),
  };
}
function validatePublish(e, now) {
  const p = {};
  for (const k of [
    "templateId",
    "title",
    "description",
    "coachId",
    "campus",
    "courtId",
  ]) {
    if (typeof e[k] !== "string" || !e[k].trim()) fail("INVALID_ARGUMENT");
    p[k] = e[k].trim();
  }
  if (p.title.length > 200 || p.description.length > 20000)
    fail("INVALID_ARGUMENT");
  for (const k of [
    "startAt",
    "endAt",
    "priceYuan",
    "vipPriceYuan",
    "minParticipants",
    "maxParticipants",
  ]) {
    if (!Number.isSafeInteger(e[k])) fail("INVALID_ARGUMENT");
    p[k] = e[k];
  }
  if (
    p.startAt <= 0 ||
    p.endAt <= p.startAt ||
    p.endAt > 8640000000000000 ||
    p.startAt % (30 * MINUTE) ||
    p.endAt % (30 * MINUTE) ||
    beijing(p.startAt).day !== beijing(p.endAt).day
  )
    fail("INVALID_TIME_RANGE");
  if (p.priceYuan < 1 || !Number.isSafeInteger(p.priceYuan * 100) ||
      p.vipPriceYuan < 1 || p.vipPriceYuan > p.priceYuan)
    fail("INVALID_PRICE");
  if (p.minParticipants < 1 || p.maxParticipants < p.minParticipants)
    fail("INVALID_PARTICIPANTS");
  if (
    typeof e.publishRequestId !== "string" ||
    !/^[a-zA-Z0-9_-]{16,128}$/.test(e.publishRequestId)
  )
    fail("INVALID_ARGUMENT");
  return p;
}
function page(rows, cursor, size = 20, sortKey = "_id", desc = false) {
  if (!Number.isSafeInteger(size) || size < 1 || size > 50)
    fail("INVALID_ARGUMENT");
  const key = (r) => [
    r[sortKey] instanceof Date ? ms(r[sortKey]) : r[sortKey],
    r._id,
  ];
  const compare = (a, b) =>
    a[0] < b[0]
      ? -1
      : a[0] > b[0]
        ? 1
        : String(a[1]).localeCompare(String(b[1]));
  rows = [...rows].sort((a, b) => compare(key(a), key(b)) * (desc ? -1 : 1));
  if (cursor) {
    let value;
    try {
      value = JSON.parse(Buffer.from(cursor, "base64url").toString());
    } catch (_) {
      fail("INVALID_ARGUMENT");
    }
    if (!Array.isArray(value) || value.length !== 2) fail("INVALID_ARGUMENT");
    rows = rows.filter((r) => compare(key(r), value) * (desc ? -1 : 1) > 0);
  }
  const items = rows.slice(0, size);
  return {
    items,
    nextCursor:
      rows.length > size
        ? Buffer.from(JSON.stringify(key(items[items.length - 1]))).toString(
            "base64url",
          )
        : null,
  };
}
module.exports = {
  MINUTE,
  C,
  ms,
  hash,
  random,
  BusinessError,
  fail,
  date,
  fee,
  campusCourts,
  occupied,
  deadlines,
  beijing,
  validatePublish,
  page,
};
