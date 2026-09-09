const statuses = {
  PUBLISHED: "报名中",
  CONFIRMED: "已成班",
  COMPLETED: "已结束",
  CANCELLED: "已取消",
  PENDING_PAYMENT: "待付款",
  PAID: "已支付",
  EXPIRED: "支付超时",
  REFUNDING: "退款中",
  REFUND_FAILED: "退款异常",
};
const refundStatuses = {
  PENDING: "退款待处理",
  PROCESSING: "退款处理中",
  SUCCESS: "已全额退款",
  FAILED: "退款异常",
};
const reasons = {
  AUTH_REQUIRED: "授权手机号后报名",
  COURSE_FULL: "名额已满",
  ENROLLMENT_CLOSED: "报名已截止",
  ALREADY_ENROLLED: "已有报名记录",
  COURSE_CANCELLED: "课程已取消",
  COURSE_COMPLETED: "课程已结束",
};
const pad = (value) => String(value).padStart(2, "0");
function dateParts(value) {
  const d = new Date(Number(value) + 8 * 3600000);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    day: "日一二三四五六"[d.getUTCDay()],
  };
}
function dateTime(value) {
  if (!Number.isFinite(value)) return "";
  const d = dateParts(value);
  return `${d.date} ${d.time}`;
}
function enrollment(value) {
  if (!value) return null;
  return Object.assign({}, value, {
    statusLabel: statuses[value.status] || value.status,
    refundLabel: value.refund ? refundStatuses[value.refund.status] : "",
    tone:
      value.status === "REFUND_FAILED"
        ? "danger"
        : ["PENDING_PAYMENT", "REFUNDING"].includes(value.status)
          ? "amber"
          : "blue",
  });
}
function courtLabel(value) {
  const text = String(value == null ? "" : value);
  return /^\d+$/.test(text) ? `${text}号场` : text;
}
function course(value) {
  const d = dateParts(value.startAt);
  return Object.assign({}, value, {
    courtLabel: courtLabel(value.courtNumber),
    statusLabel:
      value.status === "PUBLISHED" && value.paidCount >= value.minParticipants
        ? "即将成班"
        : statuses[value.status],
    tone:
      value.status === "PUBLISHED"
        ? "green"
        : ["CANCELLED", "COMPLETED"].includes(value.status)
          ? "muted"
          : "blue",
    timeLabel: `${d.date} 周${d.day} · ${d.time}–${dateParts(value.endAt).time}`,
    deadlineLabel: dateTime(value.enrollmentDeadlineAt),
    cancelDeadlineLabel: dateTime(value.cancelDeadlineAt),
    progress: Math.min(
      100,
      Math.round((value.paidCount / Math.max(1, value.maxParticipants)) * 100),
    ),
    disabledLabel: reasons[value.enrollDisabledReason] || "当前不可报名",
  });
}
function item(value) {
  return {
    id: value.course.id,
    course: course(value.course),
    myEnrollment: enrollment(value.myEnrollment),
  };
}
function parseBeijing(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:(00|30)$/.test(time))
    return NaN;
  const [y, m, d] = date.split("-").map(Number);
  const [h, n] = time.split(":").map(Number);
  if (h > 23) return NaN;
  const value = Date.UTC(y, m - 1, d, h - 8, n);
  const parts = dateParts(value);
  return parts.date === date && parts.time === time ? value : NaN;
}
module.exports = {
  courtLabel,
  course,
  enrollment,
  item,
  dateTime,
  dateParts,
  parseBeijing,
  statuses,
  refundStatuses,
};
