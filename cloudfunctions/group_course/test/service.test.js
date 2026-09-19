"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createService } = require("../lib/service");
const { C, MINUTE, hash, beijing, fee } = require("../lib/core");
const { paymentResult, refundResult } = require("../lib/gateway");
const { createRepository } = require("../lib/repository");
const { fixture, published, paid } = require("./helpers");
test("publish atomic rollback, immutable replay and owned slots", async () => {
  const f = await fixture();
  f.repo.failWrite = (n, id, v) => n === C.course;
  assert.equal((await f.publish()).success, false);
  assert.equal((await f.repo.scan(C.slot)).length, 0);
  f.repo.failWrite = null;
  const r = await f.publish();
  const c = await f.repo.get(C.course, r.data.courseId);
  assert.equal(c.description, "管理员确认后的内容");
  assert.equal((await f.repo.scan(C.slot)).length, 2);
  assert.equal((await f.publish()).data.replayed, true);
  await f.repo.set("group_course_template", "template", { enabled: false });
  assert.equal((await f.publish()).data.replayed, true);
  assert.equal(
    (
      await f.request("admin", "publish", {
        ...c,
        startAt: c.startAt.getTime(),
        endAt: c.endAt.getTime(),
        title: "changed",
      })
    ).error,
    "REQUEST_ID_CONFLICT",
  );
});
test("publish slot conflicts roll back all writes and free slot loses stale links", async () => {
  const f = await fixture();
  await f.repo.set(C.slot, "legacy", {
    campus: "东区",
    court_id: "1_20260906_18:30",
    status: "booked",
    version: 2,
  });
  assert.equal((await f.publish()).error, "COURT_CONFLICT");
  assert.equal((await f.repo.scan(C.slot)).length, 1);
  await f.repo.set(C.slot, "legacy", {
    campus: "东区",
    court_id: "1_20260906_18:30",
    status: "free",
    version: 2,
    rush_id: "old",
    order_id: "old",
  });
  assert.equal((await f.publish()).success, true);
  const s = await f.repo.get(C.slot, "legacy");
  assert.equal(s.version, 3);
  assert.equal(s.rush_id, undefined);
  assert.equal(s.order_id, undefined);
});
test("shared login phone queries live permissions and never trusts client role or VIP", async () => {
  const f = await published();
  const missing = await f.service.handle({ action: "cancelCourse", courseId: f.id, isAdmin: true }, { OPENID: "user" });
  assert.equal(missing.error, "AUTH_REQUIRED");
  const fakeRole = await f.service.handle({ action: "cancelCourse", courseId: f.id, phoneNumber: "user", isAdmin: true }, { OPENID: "user" });
  assert.equal(fakeRole.error, "FORBIDDEN");
  const guestVip = await f.request("user", "list", { scope: "public", isVip: true });
  assert.equal(guestVip.data.viewer.isVip, false);
  await f.repo.set("manager", "admin", { phoneNumber: "admin", courtRushManager: 0 });
  assert.equal((await f.request("admin", "cancelCourse", { courseId: f.id })).error, "FORBIDDEN");
});
test("concurrent last seat enrollment never overbooks and retry returns same payment", async () => {
  const f = await published();
  const c = await f.repo.get(C.course, f.id);
  c.maxParticipants = 1;
  await f.repo.set(C.course, f.id, c);
  const rs = await Promise.all(
    ["a", "b"].map((p) => f.request(p, "enroll", { courseId: f.id })),
  );
  assert.equal(rs.filter((r) => r.success).length, 1);
  assert.equal(rs.find((r) => !r.success).error, "COURSE_FULL");
  const winner = rs[0].success ? "a" : "b";
  const again = await f.request(winner, "enroll", { courseId: f.id });
  assert.equal(again.success, true);
  assert.equal(f.calls.create, 1);
  assert.equal((await f.repo.scan(C.payment)).length, 1);
});
test("Manual VIP price and two minute payment / three minute hold boundaries", async () => {
  const f = await published();
  const r = await f.request("vip", "enroll", { courseId: f.id });
  assert.equal(r.data.enrollment.actualFeeYuan, 67);
  f.now += 2 * MINUTE;
  assert.equal(
    (await f.request("vip", "enroll", { courseId: f.id })).data.payment,
    null,
  );
  assert.equal(f.calls.create, 1);
  f.now += MINUTE;
  const next = await f.request("vip", "enroll", { courseId: f.id });
  assert.equal(next.success, true);
  assert.equal(f.calls.create, 2);
  assert.equal(next.data.enrollment.id, r.data.enrollment.id);
  assert.equal(
    (await f.repo.scan(C.payment)).filter((x) => x.status === "EXPIRED").length,
    1,
  );
  assert.equal(fee(2, true, 1), 1);
});
test("callbacks query gateway, ignore spoofed success and reject amount mismatch", async () => {
  const f = await published();
  await f.request("user", "enroll", { courseId: f.id });
  const p = (await f.repo.scan(C.payment))[0];
  await f.service.paymentCallback({
    outTradeNo: p.outTradeNo,
    tradeState: "SUCCESS",
    totalFee: 1,
  });
  assert.equal((await f.repo.get(C.payment, p._id)).status, "PENDING");
  f.gateway.queryPayment = async () => {
    throw Error("network");
  };
  assert.equal(
    (await f.service.paymentCallback({ outTradeNo: p.outTradeNo })).errcode,
    1,
  );
  assert.throws(
    () =>
      paymentResult(
        {
          returnCode: "SUCCESS",
          resultCode: "SUCCESS",
          tradeState: "SUCCESS",
          outTradeNo: p.outTradeNo,
          totalFee: 1,
          transactionId: "tx",
        },
        p,
      ),
    /MISMATCH/,
  );
  assert.equal(paymentResult({ errCode: 0 }, p).state, "UNKNOWN");
});
test("delayed formation counts paid enrollments, cancellation wins callback race", async () => {
  const f = await published();
  const paidAt = f.now;
  const { p } = await paid(f);
  const c = await f.repo.get(C.course, f.id);
  f.now = c.startAt.getTime() - 57 * MINUTE + 10 * MINUTE;
  await f.service.settleCourse(f.id);
  assert.equal((await f.repo.get(C.course, f.id)).status, "CONFIRMED");
  const other = await published();
  const e = await other.request("user", "enroll", { courseId: other.id });
  await other.request("admin", "cancelCourse", { courseId: other.id });
  const op = (await other.repo.scan(C.payment))[0];
  await other.service.confirmPayment(op._id, {
    state: "PAID",
    transactionId: "tx",
  });
  assert.equal(
    (await other.repo.get(C.enrollment, e.data.enrollment.id)).status,
    "REFUNDING",
  );
  assert.equal((await other.repo.scan(C.refund)).length, 1);
  assert.equal((await other.repo.get(C.course, other.id)).status, "CANCELLED");
  await f.service.confirmPayment(p._id, { state: "PAID", transactionId: "tx" });
  assert.equal(
    (await f.repo.get(C.payment, p._id)).paidAt.getTime(),
    paidAt,
  );
});
test("cancellation interruption repair, idempotent refund lease, success frees seat only once", async () => {
  const f = await published();
  const { en } = await paid(f);
  f.repo.failWrite = (n) => n === C.refund;
  await f.request("admin", "cancelCourse", { courseId: f.id });
  assert.equal((await f.repo.get(C.course, f.id)).status, "CANCELLED");
  assert.equal((await f.repo.scan(C.refund)).length, 0);
  f.repo.failWrite = null;
  await f.service.repairCancelled(f.id);
  await f.service.repairCancelled(f.id);
  const r = (await f.repo.scan(C.refund))[0];
  assert.ok(r);
  await Promise.allSettled([
    f.service.runRefund(r._id),
    f.service.runRefund(r._id),
  ]);
  assert.equal(f.calls.submit, 1);
  assert.equal((await f.repo.get(C.enrollment, en._id)).status, "REFUNDING");
  f.now += MINUTE;
  await f.service.runRefund(r._id);
  assert.equal((await f.repo.get(C.enrollment, en._id)).status, "CANCELLED");
  await f.service.applyRefund(r._id, { state: "FAILED" });
  assert.equal((await f.repo.get(C.refund, r._id)).status, "SUCCESS");
  assert.ok(
    (await f.repo.scan(C.slot)).every(
      (s) => s.status === "free" && s.version === 2,
    ),
  );
});
test("lease expiry queries before same-id resubmit; pause failure is not revived by repair", async () => {
  const f = await published();
  await paid(f);
  await f.request("user", "cancelEnrollment", { courseId: f.id });
  const r = (await f.repo.scan(C.refund))[0];
  await f.repo.set(C.refund, r._id, {
    ...r,
    status: "PROCESSING",
    nextAction: "QUERY",
    leaseToken: "dead-worker",
    leaseUntil: new Date(f.now + 2 * MINUTE),
  });
  await f.service.runRefund(r._id);
  assert.equal(f.calls.query, 0);
  f.now += 2 * MINUTE;
  f.gateway.queryRefund = async () => {
    f.calls.query++;
    return { state: "NOT_FOUND" };
  };
  await f.service.runRefund(r._id);
  assert.equal(f.calls.query, 1);
  assert.equal(f.calls.submit, 0);
  f.now += MINUTE;
  await f.service.runRefund(r._id);
  assert.equal(f.calls.submit, 1);
  await f.service.applyRefund(r._id, {
    state: "FAILED",
    channelStatus: "CHANGE",
  });
  await f.request("admin", "cancelCourse", { courseId: f.id });
  assert.equal((await f.repo.get(C.refund, r._id)).nextRetryAt, null);
  assert.equal(
    (await f.repo.get(C.enrollment, hash(f.id, "user"))).status,
    "REFUND_FAILED",
  );
});
test("refund SDK indexed snake/camel responses match exact refund and amounts", () => {
  const p = { outTradeNo: "pay" },
    r = { outRefundNo: "target", amountYuan: 20 };
  for (const raw of [
    {
      return_code: "SUCCESS",
      result_code: "SUCCESS",
      out_trade_no: "pay",
      out_refund_no_0: "other",
      refund_fee_0: 1,
      refund_status_0: "SUCCESS",
      out_refund_no_1: "target",
      refund_fee_1: 2000,
      refund_status_1: "SUCCESS",
      refund_id_1: "wx",
    },
    {
      returnCode: "SUCCESS",
      resultCode: "SUCCESS",
      outTradeNo: "pay",
      outRefundNo0: "target",
      refundFee0: 2000,
      refundStatus0: "PROCESSING",
    },
  ])
    assert.ok(
      ["SUCCESS", "PROCESSING"].includes(refundResult(raw, r, p).state),
    );
  assert.throws(
    () =>
      refundResult(
        {
          returnCode: "SUCCESS",
          resultCode: "SUCCESS",
          outTradeNo: "pay",
          outRefundNo0: "target",
          refundFee0: 1,
          refundStatus0: "SUCCESS",
        },
        r,
        p,
      ),
    /MISMATCH/,
  );
  assert.equal(
    refundResult(
      { returnCode: "SUCCESS", resultCode: "FAIL", errCode: "REFUNDNOTEXIST" },
      r,
      p,
    ).state,
    "NOT_FOUND",
  );
});
test("cancelled courses privacy, admin roster pagination and guest DTO", async () => {
  const f = await published();
  await paid(f);
  const guest = await f.request(null, "detail", { courseId: f.id });
  assert.equal(guest.data.course.canEnroll, false);
  assert.equal(guest.data.participants, undefined);
  assert.equal(guest.data.payment, null);
  for (let i = 0; i < 55; i++)
    await f.repo.set(C.enrollment, "extra" + String(i).padStart(2, "0"), {
      courseId: f.id,
      phoneNumber: "p" + i,
      status: "EXPIRED",
      createdAt: new Date(f.now + i),
      attemptStartedAt: new Date(f.now),
      actualFeeYuan: 101,
      isVip: false,
      originalPriceYuan: 101,
    });
  const a = await f.request("admin", "detail", {
    courseId: f.id,
    participantPageSize: 50,
  });
  assert.equal(a.data.participants.length, 50);
  const b = await f.request("admin", "detail", {
    courseId: f.id,
    participantPageSize: 50,
    participantCursor: a.data.participantNextCursor,
  });
  assert.equal(b.data.participants.length, 6);
  await f.request("admin", "cancelCourse", { courseId: f.id });
  assert.equal(
    (await f.request(null, "detail", { courseId: f.id })).error,
    "COURSE_NOT_FOUND",
  );
  assert.equal(
    (await f.request("user", "detail", { courseId: f.id })).success,
    true,
  );
});
test("maintenance reaches beyond first 50 courses and rejects client clocks", async () => {
  const f = await published();
  const c = await f.repo.get(C.course, f.id);
  for (let i = 0; i < 61; i++)
    await f.repo.set(C.course, "course" + String(i).padStart(2, "0"), {
      ...c,
      status: "CANCELLED",
    });
  const x = await f.service.maintenance({ Type: "Timer", now: 0 }, {});
  assert.equal(x.processedCourses, 50);
  f.now += MINUTE;
  await f.service.maintenance({ Type: "Timer" }, {});
  assert.equal(
    (await f.repo.scan(C.course, { status: "CANCELLED" })).filter(
      (c) => c.cancellationCleanupCompleted,
    ).length,
    61,
  );
  await assert.rejects(
    () => f.service.maintenance({ Type: "Timer" }, { OPENID: "attacker" }),
    (e) => e.code === "FORBIDDEN",
  );
  await assert.rejects(
    () => f.service.maintenance({}, {}),
    (e) => e.code === "FORBIDDEN",
  );
});
test("CloudBase lowercase timer settles courses and still rejects client invocations", async () => {
  const f = await published();
  const c = await f.repo.get(C.course, f.id);
  f.now = c.startAt.getTime() - 57 * MINUTE;
  const event = {
    Type: "timer",
    TriggerName: "groupCourseEveryMinute",
    Time: new Date(f.now).toISOString(),
    Message: "",
    tcbContext: {},
    userInfo: {},
  };
  await assert.rejects(
    () => f.service.maintenance(event, { OPENID: "attacker" }),
    (e) => e.code === "FORBIDDEN",
  );
  assert.equal((await f.repo.get(C.course, f.id)).status, "PUBLISHED");
  for (const invalid of [{}, { Type: "http" }, null]) {
    await assert.rejects(
      () => f.service.maintenance(invalid, {}),
      (e) => e.code === "FORBIDDEN",
    );
  }
  await f.service.maintenance(event, {});
  const cancelled = await f.repo.get(C.course, f.id);
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.cancelReason, "MIN_PARTICIPANTS_NOT_MET");
});
test("stable repository pagination reads all >100 records", async () => {
  const rows = Array.from({ length: 215 }, (_, i) => ({
    _id: String(i).padStart(3, "0"),
  }));
  const db = {
    command: { gt: (v) => v, and: (w, condition) => condition },
    collection: () => ({
      where: (filter) => ({
        orderBy: () => ({
          limit: () => ({
            get: async () => ({
              data: rows
                .filter((r) => !filter._id || r._id > filter._id)
                .slice(0, 100),
            }),
          }),
        }),
      }),
    }),
  };
  assert.equal((await createRepository(db).scan("x")).length, 215);
});
test("Beijing slot keys independent of host timezone and invalid ranges rejected", async () => {
  assert.equal(beijing(Date.parse("2026-09-06T10:30:00Z")).time, "18:30");
  const f = await fixture();
  const invalid = await f.request("admin", "publish", {
    publishRequestId: "request_1234567890",
    templateId: "template",
    title: "x",
    description: "x",
    coachId: "coach",
    campus: "东区",
    courtId: "court",
    startAt: Infinity,
    endAt: 1,
    priceYuan: 2,
    minParticipants: 1,
    maxParticipants: 2,
  });
  assert.equal(invalid.error, "INVALID_ARGUMENT");
});
test("refund worker progresses while payment queries remain pending", async () => {
  const f = await published();
  await paid(f);
  await f.request("user", "cancelEnrollment", { courseId: f.id });
  await f.request("second", "enroll", { courseId: f.id });
  let resolveQuery;
  f.gateway.queryPayment = () =>
    new Promise((resolve) => {
      resolveQuery = resolve;
    });
  const maintenance = f.service.maintenance({ Type: "Timer" }, {});
  for (let i = 0; i < 20 && f.calls.submit === 0; i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.submit, 1);
  resolveQuery({ state: "UNPAID" });
  await maintenance;
});
test("maintenance counts current paid enrollments regardless of payment timestamp", async () => {
  for (const timestamp of ["late", "missing"]) {
    const f = await published();
    const c = await f.repo.get(C.course, f.id);
    c.minParticipants = 2;
    c.maxParticipants = 5;
    await f.repo.set(C.course, f.id, c);
    await paid(f, "user");
    const second = await f.request("second", "enroll", { courseId: f.id });
    const p = (await f.repo.scan(C.payment, { enrollmentId: second.data.enrollment.id }))[0];
    f.now = c.startAt.getTime() - 57 * MINUTE + 1;
    await f.service.confirmPayment(p._id, {
      state: "PAID",
      transactionId: "late",
    });
    if (timestamp === "missing") {
      const enrollment = await f.repo.get(C.enrollment, p.enrollmentId);
      enrollment.paidAt = null;
      await f.repo.set(C.enrollment, enrollment._id, enrollment);
    }
    await f.service.maintenance({ Type: "timer" }, {});
    assert.equal((await f.repo.get(C.course, f.id)).status, "CONFIRMED");
    await f.service.maintenance({ Type: "timer" }, {});
    assert.equal((await f.repo.get(C.course, f.id)).status, "CONFIRMED");
    assert.equal((await f.repo.scan(C.refund)).length, 0);
  }
});
test("maintenance cancels when current paid count is below minimum despite pending enrollment", async () => {
  const f = await published();
  const c = await f.repo.get(C.course, f.id);
  c.minParticipants = 2;
  c.maxParticipants = 5;
  await f.repo.set(C.course, f.id, c);
  await paid(f, "user");
  await f.request("second", "enroll", { courseId: f.id });
  f.now = c.startAt.getTime() - 57 * MINUTE + 1;
  await f.service.maintenance({ Type: "timer" }, {});
  const cancelled = await f.repo.get(C.course, f.id);
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.cancelReason, "MIN_PARTICIPANTS_NOT_MET");
});
test("customer cancellation and detail eligibility agree across the twelve-hour boundary", async () => {
  for (const remaining of [12 * 60 * MINUTE + 1, 12 * 60 * MINUTE, 12 * 60 * MINUTE - 1, 10 * 60 * MINUTE, 6 * 60 * MINUTE]) {
    const f = await published();
    const { en } = await paid(f);
    const c = await f.repo.get(C.course, f.id);
    f.now = c.startAt.getTime() - remaining;
    const allowed = remaining > 12 * 60 * MINUTE;
    const detail = await f.request("user", "detail", { courseId: f.id });
    assert.equal(detail.success, true);
    assert.equal(detail.data.course.cancelDeadlineAt, c.startAt.getTime() - 12 * 60 * MINUTE);
    assert.equal(detail.data.myEnrollment.canCancel, allowed);
    const result = await f.request("user", "cancelEnrollment", { courseId: f.id });
    assert.equal(result.success, allowed);
    if (!allowed) assert.equal(result.error, "CANCEL_WINDOW_CLOSED");
    assert.equal((await f.repo.get(C.enrollment, en._id)).status, allowed ? "REFUNDING" : "PAID");
    assert.equal((await f.repo.scan(C.refund)).length, allowed ? 1 : 0);
  }
});
test("twelve-hour cancellation cutoff is strict and VIP failure never charges original price", async () => {
  const f = await published();
  await paid(f);
  const c = await f.repo.get(C.course, f.id);
  f.now = c.startAt.getTime() - 12 * 60 * MINUTE;
  assert.equal(
    (await f.request("user", "cancelEnrollment", { courseId: f.id })).error,
    "CANCEL_WINDOW_CLOSED",
  );
  const service = createService({
    repo: f.repo,
    gateway: f.gateway,
    vip: async () => {
      throw Error("down");
    },
    clock: () => f.now,
    logger: { error() {}, warn() {} },
  });
  const r = await service.handle(
    { action: "enroll", courseId: f.id, phoneNumber: "new" },
    { OPENID: "openid-new" },
  );
  assert.equal(r.error, "VIP_UNAVAILABLE");
  assert.equal(f.calls.create, 1);
});
test("expired previous payment cannot mutate a new enrollment attempt", async () => {
  const f = await published();
  await f.request("user", "enroll", { courseId: f.id });
  const first = (await f.repo.scan(C.payment))[0];
  f.now += 3 * MINUTE;
  const next = await f.request("user", "enroll", { courseId: f.id });
  await f.service.confirmPayment(first._id, {
    state: "PAID",
    transactionId: "late",
  });
  assert.equal(
    (await f.repo.get(C.enrollment, next.data.enrollment.id)).status,
    "PENDING_PAYMENT",
  );
  assert.equal((await f.repo.scan(C.refund)).length, 0);
});
test("cleanup marker does not gate independently persisted refund tasks or callbacks", async () => {
  const f = await published();
  await f.request("user", "enroll", { courseId: f.id });
  await f.request("admin", "cancelCourse", { courseId: f.id });
  const c = await f.repo.get(C.course, f.id);
  // Simulate a concurrently completed cleanup snapshot. Payment conversion and
  // refund workers operate independently of the course cleanup scheduling marker.
  await f.repo.set(C.course, f.id, {
    ...c,
    cancellationCleanupCompleted: true,
  });
  const p = (await f.repo.scan(C.payment))[0];
  f.gateway.queryPayment = async () => ({ state: "PAID", transactionId: "tx" });
  assert.equal(
    (await f.service.paymentCallback({ outTradeNo: p.outTradeNo })).errcode,
    0,
  );
  await f.service.maintenance({ Type: "Timer" }, {});
  assert.equal(f.calls.submit, 1);
  f.now += MINUTE;
  await f.service.maintenance({ Type: "Timer" }, {});
  assert.equal((await f.repo.scan(C.refund))[0].status, "SUCCESS");
});
test("course cancellation immediately hides payment and expires the hold without losing a concurrent paid callback", async () => {
  const f = await published();
  const enrolled = await f.request("user", "enroll", { courseId: f.id });
  assert.ok(enrolled.data.payment);
  const p = (await f.repo.scan(C.payment))[0];
  await f.request("admin", "cancelCourse", { courseId: f.id });
  const detail = await f.request("user", "detail", { courseId: f.id });
  assert.equal(detail.data.payment, null);
  assert.equal(detail.data.myEnrollment.status, "EXPIRED");
  assert.equal(detail.data.course.occupiedCount, 0);
  assert.equal(
    (await f.request("user", "enroll", { courseId: f.id })).error,
    "ENROLLMENT_CLOSED",
  );
  assert.equal((await f.repo.get(C.payment, p._id)).status, "PENDING");
  f.gateway.queryPayment = async () => ({
    state: "PAID",
    transactionId: "concurrent-payment",
  });
  assert.equal(
    (await f.service.paymentCallback({ outTradeNo: p.outTradeNo })).errcode,
    0,
  );
  assert.equal(
    (await f.repo.get(C.enrollment, enrolled.data.enrollment.id)).status,
    "REFUNDING",
  );
  assert.equal((await f.repo.scan(C.refund)).length, 1);
});
test("cancelled payment stays queryable while unknown and expires only after a definitive unpaid query", async () => {
  const f = await published();
  await f.request("user", "enroll", { courseId: f.id });
  const p = (await f.repo.scan(C.payment))[0];
  await f.request("admin", "cancelCourse", { courseId: f.id });
  f.now += 3 * MINUTE;
  f.gateway.queryPayment = async () => ({ state: "UNKNOWN" });
  await f.service.maintenance({ Type: "Timer" }, {});
  assert.equal((await f.repo.get(C.payment, p._id)).status, "PENDING");
  f.now += MINUTE;
  f.gateway.queryPayment = async () => ({ state: "UNPAID" });
  await f.service.maintenance({ Type: "Timer" }, {});
  assert.equal((await f.repo.get(C.payment, p._id)).status, "EXPIRED");
});

test("enrollment identity depends on phone, never on payment OPENID", async () => {
  const f = await published();
  const first = await f.service.handle({ action: "enroll", courseId: f.id, phoneNumber: "first-phone" }, { OPENID: "wechat-a" });
  assert.equal(first.success, true);
  const samePhone = await f.service.handle({ action: "enroll", courseId: f.id, phoneNumber: "first-phone" }, { OPENID: "wechat-b" });
  assert.equal(samePhone.success, true);
  assert.equal(samePhone.data.enrollment.id, first.data.enrollment.id);
  const otherPhone = await f.service.handle({ action: "enroll", courseId: f.id, phoneNumber: "second-phone" }, { OPENID: "wechat-a" });
  assert.equal(otherPhone.success, true);
  assert.notEqual(otherPhone.data.enrollment.id, first.data.enrollment.id);
  assert.equal((await f.repo.scan(C.enrollment)).length, 2);
  assert.equal(f.calls.create, 2);
});

test("teaching candidates reuse manager name and phone without separate coach flags", async () => {
  const f = await fixture();
  await f.repo.set("manager", "missing-name", { phoneNumber: "other", password: "private" });
  await f.repo.set("manager", "missing-phone", { name: "无号码" });
  await f.repo.set("manager", "coach", { name: " 王教练 ", phoneNumber: "coach-phone", password: "private", specialManager: 0 });
  await f.repo.set("coach", "legacy", { name: "旧独立教练", enabled: true });
  const context = await f.request("admin", "context");
  assert.deepEqual(context.data.coaches, [{ id: "coach", name: "王教练", introduction: "" }]);
  const course = await f.publish();
  assert.equal(course.success, true);
  assert.equal((await f.repo.get(C.course, course.data.courseId)).coachName, "王教练");
  assert.equal((await f.request("coach-phone", "context")).data.viewer.isAdmin, false);
});

test("publish revalidates manager candidate and never reads same-id legacy coach", async () => {
  const f = await fixture();
  await f.repo.set("coach", "coach", { name: "旧独立教练", enabled: true });
  await f.repo.set("manager", "coach", { name: "", phoneNumber: "coach-phone" });
  assert.equal((await f.publish()).error, "COACH_UNAVAILABLE");
  assert.equal((await f.repo.scan(C.course)).length, 0);
  assert.equal((await f.repo.scan(C.slot)).length, 0);
});

test("shared club_member lookup uses booking VIP formula and distinguishes outage from nonmember", async () => {
  const { createVipLookup } = require("../lib/memberVip");
  let result;
  const lookup = createVipLookup({ callFunction: async request => {
    assert.equal(request.name, "club_member");
    assert.equal(request.data.phoneNumber, "phone");
    return { result };
  } });
  for (const row of [{ rest_charge: 1 }, { annual_count: 1 }, { times_count: 1 }]) {
    result = { success: true, data: row };
    assert.equal(await lookup("phone"), true);
  }
  result = { success: true, data: { rest_charge: 0 } };
  assert.equal(await lookup("phone"), false);
  result = { success: false, data: null, message: "未找到对应的会员信息" };
  assert.equal(await lookup("phone"), false);
  result = { success: false, message: "查询失败" };
  await assert.rejects(() => lookup("phone"), /MEMBER_LOOKUP_FAILED/);
});

test("VIP outage does not block context, publication or cancellation", async () => {
  const f = await published();
  await paid(f);
  let lookups = 0;
  const service = createService({ repo: f.repo, gateway: f.gateway, clock: () => f.now,
    vip: async () => { lookups++; throw Error("outage"); }, logger: { error() {}, warn() {} } });
  const call = (action, phoneNumber, extra = {}) => service.handle({ action, phoneNumber, ...extra }, { OPENID: "wx" });
  assert.equal((await call("context", "admin")).success, true);
  const c = await f.repo.get(C.course, f.id);
  assert.equal((await call("publish", "admin", { ...c, startAt: c.startAt.getTime(), endAt: c.endAt.getTime() })).success, true);
  assert.equal((await call("cancelEnrollment", "user", { courseId: f.id })).success, true);
  assert.equal((await call("cancelCourse", "admin", { courseId: f.id })).success, true);
  assert.equal(lookups, 0);
  assert.equal((await call("enroll", "user", { courseId: f.id })).error, "VIP_UNAVAILABLE");
  assert.equal(lookups, 1);
});

test("publish requires a manual VIP price and includes it in immutable replay", async () => {
  const f = await fixture();
  for (const vipPriceYuan of [undefined, null, "67", 0, -1, 1.5, 102]) {
    const result = await f.publish({ vipPriceYuan });
    assert.equal(result.success, false);
    assert.ok(["INVALID_PRICE", "INVALID_ARGUMENT"].includes(result.error));
  }
  assert.equal((await f.repo.scan(C.course)).length, 0);
  const result = await f.publish({ priceYuan: 1, vipPriceYuan: 1 });
  assert.equal(result.success, true);
  assert.equal((await f.publish({ priceYuan: 1, vipPriceYuan: 1 })).data.replayed, true);
  assert.equal((await f.publish({ priceYuan: 2, vipPriceYuan: 1 })).error, "REQUEST_ID_CONFLICT");
  assert.throws(() => fee(101, true), { code: "INVALID_PRICE" });
});

test("manual VIP price drives display, gateway amount and retained payment snapshot", async () => {
  const f = await published();
  const detail = await f.request("vip", "detail", { courseId: f.id });
  assert.equal(detail.data.course.vipPriceYuan, 67);
  assert.equal(detail.data.course.actualFeeYuan, 67);
  assert.equal((await f.request("user", "detail", { courseId: f.id })).data.course.actualFeeYuan, 101);
  let charged;
  const original = f.gateway.createPayment;
  f.gateway.createPayment = async (payment, ...args) => {
    charged = payment.amountYuan;
    return original(payment, ...args);
  };
  await f.request("vip", "enroll", { courseId: f.id });
  assert.equal(charged, 67);
  const course = await f.repo.get(C.course, f.id);
  await f.repo.set(C.course, f.id, { ...course, vipPriceYuan: 60 });
  const replay = await f.request("vip", "enroll", { courseId: f.id });
  assert.equal(replay.data.enrollment.actualFeeYuan, 67);
  assert.equal(f.calls.create, 1);
  assert.equal((await f.publish({ vipPriceYuan: 66 })).error, "REQUEST_ID_CONFLICT");
});

async function addUnmanaged(f, name = "西区") {
  await f.repo.set("campus", name, { name, enabled: true, bookingManaged: false });
  const result = await f.request("admin", "context");
  return result.data.courts.filter((court) => court.campus === name);
}

test("unmanaged empty campuses expose stable separate defaults; configured and managed courts stay authoritative", async () => {
  const f = await fixture();
  const west = await addUnmanaged(f);
  const south = await addUnmanaged(f, "南区");
  assert.deepEqual(west.map((court) => court.courtNumber), ["1", "2"]);
  assert.notEqual(west[0].id, south[0].id);
  assert.deepEqual(await addUnmanaged(f), west);
  await f.repo.set("campus", "empty", { name: "空受管理校区", enabled: true, bookingManaged: true });
  await f.repo.set("campus", "disabled", { name: "停用校区", enabled: false, bookingManaged: false });
  let context = (await f.request("admin", "context")).data;
  assert.equal(context.courts.some((court) => ["空受管理校区", "停用校区"].includes(court.campus)), false);
  assert.equal((await f.publish({ campus: "空受管理校区", courtId: west[0].id })).error, "COURT_UNAVAILABLE");
  assert.equal((await f.publish({ campus: "南区", courtId: west[0].id })).error, "COURT_UNAVAILABLE");
  assert.equal((await f.publish({ campus: "西区", courtId: "group_course_default_forged" })).error, "COURT_UNAVAILABLE");
  await f.repo.set("court", "west-real", { campus: "西区", courtNumber: "3" });
  context = (await f.request("admin", "context")).data;
  assert.deepEqual(context.courts.filter((court) => court.campus === "西区").map((court) => court.id), ["west-real"]);
  assert.equal((await f.publish({ campus: "西区", courtId: west[0].id })).error, "COURT_UNAVAILABLE");
  assert.equal((await f.publish({ campus: "西区", courtId: "west-real" })).success, true);
});

test("default courts publish without booking writes and enforce coach and campus-number conflicts", async () => {
  const f = await fixture();
  const courts = await addUnmanaged(f);
  const first = await f.publish({ campus: "西区", courtId: courts[0].id });
  assert.equal(first.success, true);
  const course = await f.repo.get(C.course, first.data.courseId);
  assert.equal(course.courtNumber, "1");
  assert.equal(course.bookingManaged, false);
  assert.deepEqual(course.courtIds, []);
  assert.equal((await f.repo.scan(C.slot)).length, 0);
  assert.equal((await f.repo.scan("court", { campus: "西区" })).length, 0);
  assert.equal((await f.publish({ campus: "西区", courtId: courts[0].id })).data.replayed, true);
  const second = { campus: "西区", courtId: courts[1].id, publishRequestId: "request_second_123456789" };
  assert.equal((await f.publish(second)).error, "COACH_CONFLICT");
  await f.repo.set("manager", "coach2", { name: "第二位教练", phoneNumber: "coach2" });
  assert.equal((await f.publish({ ...second, coachId: "coach2", courtId: courts[0].id })).error, "COURT_CONFLICT");
  assert.equal((await f.publish({ ...second, coachId: "coach2" })).success, true);
  // Later configured records still collide with old logical resources by campus + number.
  await f.repo.set("court", "west-real", { campus: "西区", courtNumber: "1" });
  assert.equal((await f.publish({ ...second, coachId: "coach2", courtId: "west-real", publishRequestId: "request_third_123456789", startAt: course.endAt.getTime() - 30 * MINUTE, endAt: course.endAt.getTime() + 30 * MINUTE })).error, "COACH_CONFLICT");
  await f.repo.set("manager", "coach3", { name: "第三位教练", phoneNumber: "coach3" });
  assert.equal((await f.publish({ ...second, coachId: "coach3", courtId: "west-real", publishRequestId: "request_third_123456789" })).error, "COURT_CONFLICT");
  assert.equal((await f.request("admin", "cancelCourse", { courseId: first.data.courseId })).success, true);
  assert.equal((await f.repo.scan(C.slot)).length, 0);
  assert.equal((await f.publish({ ...second, coachId: "coach3", courtId: "west-real", publishRequestId: "request_third_123456789" })).success, true);
});

test("list pages by 20 after role, campus and own-enrollment filtering, including settlement", async () => {
  for (const phone of [null, "user", "vip", "admin"]) {
    const f = await published();
    const base = await f.repo.get(C.course, f.id);
    for (let i = 0; i < 46; i++) {
      const id = `page-${String(i).padStart(2, "0")}`;
      await f.repo.set(C.course, id, {
        ...base, campus: "分页校区", startAt: new Date(f.now + (i < 5 ? 30 : 600) * MINUTE),
        endAt: new Date(f.now + 700 * MINUTE),
      });
      for (const owner of ["user", "vip", "admin"]) {
        await f.repo.set(C.enrollment, `${owner}-${id}`, {
          courseId: id, phoneNumber: owner, status: "EXPIRED",
          createdAt: new Date(f.now + i), attemptStartedAt: new Date(f.now),
          originalPriceYuan: 101, actualFeeYuan: owner === "vip" ? 67 : 101,
        });
      }
    }
    const scopes = phone ? ["public", "mine"] : ["public"];
    for (const scope of scopes) {
      let cursor;
      const ids = [], sizes = [];
      do {
        const r = await f.request(phone, "list", { scope, campus: "分页校区", cursor });
        assert.equal(r.success, true);
        sizes.push(r.data.items.length);
        for (const item of r.data.items) {
          ids.push(item.course.id);
          assert.equal(item.course.campus, "分页校区");
          assert.equal(item.course.actualFeeYuan, phone === "vip" ? 67 : 101);
          if (scope === "public" && phone !== "admin") assert.notEqual(item.course.status, "CANCELLED");
          if (scope === "mine") assert.equal(item.myEnrollment.id, `${phone}-${item.course.id}`);
        }
        cursor = r.data.nextCursor;
      } while (cursor);
      const count = scope === "public" && phone !== "admin" ? 41 : 46;
      assert.deepEqual(sizes, [20, 20, count - 40]);
      assert.equal(new Set(ids).size, count);
    }
    assert.equal((await f.request(phone, "list", { scope: "public", pageSize: "20" })).error, "INVALID_ARGUMENT");
  }
});

test("paid attendee gallery exposes only names and avatars, with 20-item pages for every role", async () => {
  const f = await published();
  for (let i = 0; i < 25; i++) {
    await f.repo.set(C.enrollment, `gallery-${i.toString().padStart(2, '0')}`, {
      courseId: f.id, phoneNumber: `private-${i}`, nickName: `学员${i}`,
      avatarUrl: `cloud://test/avatar-${i}`, status: "PAID", actualFeeYuan: 67,
      createdAt: new Date(f.now + i), paidAt: new Date(f.now), attemptStartedAt: new Date(f.now),
    });
  }
  for (const status of ["PENDING_PAYMENT", "EXPIRED", "REFUNDING", "REFUND_FAILED", "CANCELLED"]) {
    await f.repo.set(C.enrollment, status, { courseId: f.id, phoneNumber: status, status, createdAt: new Date(f.now), attemptStartedAt: new Date(f.now) });
  }
  for (const phone of [null, 'user', 'vip', 'admin']) {
    const first = await f.request(phone, 'detail', { courseId: f.id });
    assert.equal(first.success, true);
    assert.equal(first.data.paidParticipants.length, 20);
    for (const p of first.data.paidParticipants) {
      assert.deepEqual(Object.keys(p).sort(), ['avatarUrl', 'id', 'nickName']);
      assert.match(p.nickName, /^学员/);
      assert.match(p.avatarUrl, /^cloud:\/\//);
    }
    const last = await f.request(phone, 'detail', { courseId: f.id, paidParticipantCursor: first.data.paidParticipantNextCursor });
    assert.equal(last.data.paidParticipants.length, 5);
    assert.equal(last.data.paidParticipantNextCursor, null);
    assert.equal(new Set([...first.data.paidParticipants, ...last.data.paidParticipants].map(p => p.id)).size, 25);
    if (phone !== 'admin') assert.equal(first.data.participants, undefined);
  }
  const en = await f.repo.get(C.enrollment, 'gallery-00');
  await f.repo.set(C.enrollment, en._id, { ...en, status: 'REFUNDING' });
  const refreshed = await f.request('user', 'detail', { courseId: f.id });
  assert.ok(refreshed.data.paidParticipants.every(p => p.id !== en._id));
});

test("refund mismatch diagnostics distinguish missing schema, wrong order and wrong amount without exposing response values", () => {
  const p = { outTradeNo: 'expected-payment' };
  const r = { outRefundNo: 'expected-refund', amountYuan: 2 };
  const valid = { returnCode: 'SUCCESS', resultCode: 'SUCCESS', outTradeNo: p.outTradeNo,
    outRefundNo0: r.outRefundNo, refundFee0: 200, refundStatus0: 'SUCCESS' };
  for (const [raw, matches, paymentMatches, fee] of [
    [{ ...valid, outRefundNo0: 'different' }, false, true, null],
    [{ ...valid, outTradeNo: 'different' }, true, false, 200],
    [{ ...valid, refundFee0: 1 }, true, true, 1],
    [{ returnCode: 'SUCCESS', resultCode: 'SUCCESS', outTradeNo: p.outTradeNo,
      refunds: [{ outRefundNo: 'private-refund', account: 'private-account' }] }, false, true, null],
  ]) {
    assert.throws(() => refundResult(raw, r, p), error => {
      assert.equal(error.code, 'REFUND_RESPONSE_MISMATCH');
      assert.equal(error.details.refundMatched, matches);
      assert.equal(error.details.paymentMatched, paymentMatches);
      assert.equal(error.details.expectedRefundFee, 200);
      assert.equal(error.details.receivedRefundFee, fee);
      assert.ok(!JSON.stringify(error.details).includes('private-account'));
      assert.ok(!JSON.stringify(error.details).includes('private-refund'));
      if (raw.refunds) assert.deepEqual(error.details.nestedFields.refunds.fields, ['account', 'outRefundNo']);
      return true;
    });
  }
  assert.equal(refundResult(valid, r, p).state, 'SUCCESS');
});

test("CloudPay parallel refund lists select the exact refund and keep order/amount checks", () => {
  const p = { outTradeNo: 'payment' }, r = { outRefundNo: 'target', amountYuan: 2 };
  const response = {
    returnCode: 'SUCCESS', resultCode: 'SUCCESS', outTradeNo: 'payment',
    outRefundNoList: ['other', 'target'], refundFeeList: [999, 200],
    refundStatusList: ['PROCESSING', 'SUCCESS'], refundIdList: ['other-id', 'target-id'],
  };
  assert.deepEqual(refundResult(response, r, p), {
    state: 'SUCCESS', channelStatus: 'SUCCESS', refundId: 'target-id', code: '',
  });
  assert.equal(refundResult({
    return_code: 'SUCCESS', result_code: 'SUCCESS', out_trade_no: 'payment',
    out_refund_no_list: ['target'], refund_fee_list: ['200'],
    refund_status_list: ['SUCCESS'], refund_id_list: ['wx-refund'],
  }, r, p).state, 'SUCCESS');
  for (const patch of [
    { outTradeNo: 'wrong-payment' }, { outRefundNoList: ['other'] },
    { refundFeeList: [200, 999] }, { refundFeeList: [200] },
    { refundFeeList: null }, { outRefundNoList: [] },
  ]) assert.throws(() => refundResult({ ...response, ...patch }, r, p), /REFUND_RESPONSE_MISMATCH/);
  assert.equal(refundResult({ ...response, refundStatusList: ['SUCCESS', 'PROCESSING'] }, r, p).state, 'PROCESSING');
  assert.equal(refundResult({ ...response, refundStatusList: ['SUCCESS', 'CHANGE'] }, r, p).state, 'FAILED');
  assert.equal(refundResult({ ...response, refundStatusList: ['SUCCESS'] }, r, p).state, 'UNKNOWN');
});

test("refund callback and maintenance reconcile CloudPay list responses idempotently", async () => {
  const { createGateway } = require('../lib/gateway');
  for (const route of ['callback', 'maintenance']) {
    const f = await published();
    const { p, en } = await paid(f);
    await f.request('user', 'cancelEnrollment', { courseId: f.id });
    const r = (await f.repo.scan(C.refund))[0];
    await f.repo.set(C.refund, r._id, { ...r, status: 'PROCESSING', nextAction: 'QUERY' });
    let submissions = 0;
    const gateway = createGateway({ cloudPay: {
      queryRefund: async () => ({
        returnCode: 'SUCCESS', resultCode: 'SUCCESS', outTradeNo: p.outTradeNo,
        outRefundNoList: ['another-refund', r.outRefundNo],
        refundFeeList: [1, r.amountYuan * 100],
        refundStatusList: ['PROCESSING', 'SUCCESS'], refundIdList: ['other', 'wx-refund'],
      }),
      refund: async () => { submissions++; throw Error('must not resubmit'); },
    } });
    f.gateway.queryRefund = gateway.queryRefund;
    f.gateway.submitRefund = gateway.submitRefund;
    if (route === 'callback') {
      assert.equal((await f.service.refundCallback({ outRefundNo: r.outRefundNo })).errcode, 0);
    } else {
      await f.service.maintenance({ Type: 'timer' }, {});
    }
    const success = await f.repo.get(C.refund, r._id);
    assert.equal(success.status, 'SUCCESS');
    assert.equal(success.nextRetryAt, null);
    assert.equal(success.wxRefundId, route === 'callback' ? '' : 'wx-refund');
    assert.equal((await f.repo.get(C.enrollment, en._id)).status, 'CANCELLED');
    assert.equal((await f.request('user', 'detail', { courseId: f.id })).data.course.occupiedCount, 0);
    await f.service.refundCallback({ outRefundNo: r.outRefundNo });
    await f.service.maintenance({ Type: 'timer' }, {});
    assert.deepEqual((await f.repo.get(C.refund, r._id)).succeededAt, success.succeededAt);
    assert.equal((await f.repo.scan(C.refund)).length, 1);
    assert.equal(submissions, 0);
  }
});

test("nested refund list diagnostics survive JSON logging without disclosing identifiers", () => {
  const r = { outRefundNo: 'private-target', amountYuan: 2 };
  const raw = { returnCode: 'SUCCESS', resultCode: 'SUCCESS', outTradeNo: 'private-pay',
    outRefundNoList: [{ outRefundNo: r.outRefundNo }],
    refundFeeList: [{ refundFee: 200 }], refundStatusList: [{ refundStatus: 'SUCCESS' }],
    refundIdList: [{ refundId: 'private-channel-id' }],
    refund_fee_0: 200, refund_status_0: 'SUCCESS', out_refund_no_0: 'private-target',
    sign: 'private-signature', refundRecvAccoutList: ['private-account'],
  };
  assert.throws(() => refundResult(raw, r, { outTradeNo: 'private-pay' }), error => {
    const serialized = JSON.stringify(error.details);
    const details = JSON.parse(serialized);
    assert.equal(details.parserVersion, 'refund-lists-diagnostic-v2');
    assert.equal(details.rawResponse.refund_fee_0, 200);
    assert.equal(details.rawResponse.refund_status_0, 'SUCCESS');
    assert.equal(details.rawResponse.out_refund_no_0, '[REDACTED]');
    assert.deepEqual(details.rawResponse.refundFeeList, [{ refundFee: 200 }]);
    assert.equal(details.rawResponse.sign, '[REDACTED]');
    assert.deepEqual(Object.keys(details.rawResponse), Object.keys(raw));
    assert.equal(details.refundLists.outRefundNoList.entries[0].entries.outRefundNo.matchesRefundNo, true);
    assert.equal(details.refundLists.refundFeeList.entries[0].entries.refundFee.value, 200);
    assert.equal(details.refundLists.refundStatusList.entries[0].entries.refundStatus.status, 'SUCCESS');
    assert.ok(!serialized.includes('private-'));
    return true;
  });
});

test("empty refund detail lists query by payment once and apply the accepted count assumption", async () => {
  const { createGateway } = require('../lib/gateway');
  const p = { outTradeNo: 'payment' }, r = { outRefundNo: 'refund', amountYuan: 2 };
  const empty = { returnCode: 'SUCCESS', resultCode: 'SUCCESS', outTradeNo: p.outTradeNo,
    refundCount: 0, outRefundNoList: [], refundFeeList: [], refundStatusList: [], refundIdList: [] };
  const valid = { ...empty, refundCount: 1, outRefundNoList: ['refund'], refundFeeList: [200],
    refundStatusList: ['SUCCESS'], refundIdList: ['wx'] };
  for (const response of [valid, empty, { ...valid, refundFeeList: [1] },
    { ...valid, outRefundNoList: ['other'] },
    { returnCode: 'SUCCESS', resultCode: 'FAIL', errCode: 'REFUNDNOTEXIST' }]) {
    const calls = [];
    const gateway = createGateway({ cloudPay: { queryRefund: async args => {
      calls.push(args); return calls.length === 1 ? empty : response;
    } } });
    if (response.refundCount === 1) assert.equal((await gateway.queryRefund(r, p)).state, 'SUCCESS');
    else if (response.errCode) assert.equal((await gateway.queryRefund(r, p)).state, 'UNKNOWN');
    else await assert.rejects(gateway.queryRefund(r, p), error => {
      assert.equal(error.code, 'REFUND_RESPONSE_MISMATCH');
      assert.equal(error.details.queryMode, 'outTradeNo-after-empty-outRefundNo');
      return true;
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].outRefundNo, 'refund');
    assert.equal(calls[1].outRefundNo, undefined);
    assert.equal(calls[1].outTradeNo, 'payment');
    assert.equal(calls[1].offset, 0);
  }
});


test("accepted refund callback completes without querying, supports trade number and is idempotent", async () => {
  for (const key of ['outRefundNo', 'out_trade_no']) {
    const f = await published();
    const { p, en } = await paid(f);
    await f.request('user', 'cancelEnrollment', { courseId: f.id });
    const r = (await f.repo.scan(C.refund))[0];
    f.gateway.queryRefund = async () => { throw Error('must not query'); };
    assert.equal((await f.service.refundCallback({ outRefundNo: r.outRefundNo, outTradeNo: 'wrong' })).errcode, 1);
    assert.equal((await f.repo.get(C.enrollment, en._id)).status, 'REFUNDING');
    await f.service.refundCallback({ outRefundNo: 'unknown' });
    assert.equal((await f.repo.get(C.enrollment, en._id)).status, 'REFUNDING');
    const event = { [key]: key === 'outRefundNo' ? r.outRefundNo : p.outTradeNo };
    assert.equal((await f.service.refundCallback(event)).errcode, 0);
    const completed = await f.repo.get(C.refund, r._id);
    assert.equal(completed.status, 'SUCCESS');
    assert.equal(completed.confirmationBasis, 'CALLBACK_RECEIVED');
    assert.equal(completed.channelStatus, 'UNKNOWN');
    assert.equal(completed.nextRetryAt, null);
    assert.equal((await f.repo.get(C.enrollment, en._id)).status, 'CANCELLED');
    assert.equal((await f.repo.get(C.payment, p._id)).status, 'PAIDED');
    await f.service.refundCallback(event);
    assert.deepEqual(await f.repo.get(C.refund, r._id), completed);
    assert.equal((await f.request('user', 'detail', { courseId: f.id })).data.course.occupiedCount, 0);
  }
});

test("accepted refund count completes empty-list maintenance without another query or submission", async () => {
  const { createGateway } = require('../lib/gateway');
  for (const count of [1, '1']) {
    const f = await published();
    const { p, en } = await paid(f);
    await f.request('user', 'cancelEnrollment', { courseId: f.id });
    const r = (await f.repo.scan(C.refund))[0];
    await f.repo.set(C.refund, r._id, { ...r, status: 'PROCESSING', nextAction: 'QUERY' });
    let queries = 0;
    f.gateway.queryRefund = createGateway({ cloudPay: { queryRefund: async () => {
      queries++;
      return { returnCode: 'SUCCESS', resultCode: 'SUCCESS', outTradeNo: p.outTradeNo,
        refundCount: count, outRefundNoList: [], refundFeeList: [], refundStatusList: [], refundIdList: [] };
    } } }).queryRefund;
    await f.service.maintenance({ Type: 'timer' }, {});
    const completed = await f.repo.get(C.refund, r._id);
    assert.equal(queries, 1);
    assert.equal(completed.status, 'SUCCESS');
    assert.equal(completed.confirmationBasis, 'REFUND_COUNT_ONE');
    assert.equal(completed.nextRetryAt, null);
    assert.equal((await f.repo.get(C.enrollment, en._id)).status, 'CANCELLED');
    await f.service.maintenance({ Type: 'timer' }, {});
    assert.equal(queries, 1);
  }
  const p = { outTradeNo: 'payment' }, r = { outRefundNo: 'refund', amountYuan: 2 };
  const base = { returnCode: 'SUCCESS', resultCode: 'SUCCESS', outTradeNo: p.outTradeNo, refundCount: 1 };
  for (const patch of [{ refundCount: 0 }, { refundCount: 2 }, { refundCount: true }, { outTradeNo: 'other' }]) {
    assert.throws(() => refundResult({ ...base, ...patch }, r, p), /REFUND_RESPONSE_MISMATCH/);
  }
  for (const patch of [{ returnCode: 'FAIL' }, { resultCode: 'FAIL' }]) {
    assert.equal(refundResult({ ...base, ...patch }, r, p).state, 'UNKNOWN');
  }
});
