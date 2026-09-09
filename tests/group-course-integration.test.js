"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { published } = require("../cloudfunctions/group_course/test/helpers");
const { C, MINUTE } = require("../cloudfunctions/group_course/lib/core");
const view = require("../utils/groupCourseView");

function client(f, phone) {
  const storage = new Map();
  const calls = [];
  const filename = path.resolve(__dirname, "../utils/groupCourseApi.js");
  const context = {
    module: { exports: {} },
    require: (name) => require(path.resolve(path.dirname(filename), name)),
    // Test clock only: production API still uses device/server time adjustment.
    Date: class extends Date { static now() { return f.now; } },
    wx: {
      getStorageSync: (key) => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
      removeStorageSync: (key) => storage.delete(key),
      cloud: { callFunction: async ({ name, data }) => {
        calls.push({ name, data });
        return { result: await f.service.handle(data, { OPENID: "openid-" + phone }) };
      } },
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return { api: context.module.exports, calls, storage };
}

test("real frontend API and views consume backend auth, payment and refund DTOs", async () => {
  const f = await published();
  const { api, calls, storage } = client(f, "vip");
  const guest = await api.call("list", { scope: "public" });
  assert.equal(guest.viewer.authenticated, false);
  assert.equal(view.item(guest.items[0]).course.canEnroll, false);
  storage.set("phoneNumber", "vip");
  storage.set("userProfile", { nickName: "会员", avatarUrl: "cloud://test-avatar" });
  const auth = await api.call("context");
  assert.equal(auth.viewer.isVip, null);
  assert.equal((await api.call("list", { scope: "public" })).items[0].course.actualFeeYuan, 67);
  assert.equal(api.hasAuth(), true);
  const joined = await api.call("enroll", { courseId: f.id });
  assert.equal(joined.enrollment.actualFeeYuan, 67);
  assert.equal(joined.payment.paymentParams.package, "prepay_id=test");
  assert.equal(joined.payment.expiresAt, f.now + 2 * MINUTE);
  assert.equal(view.enrollment(joined.enrollment).statusLabel, "待付款");
  const payment = (await f.repo.scan(C.payment))[0];
  await f.service.confirmPayment(payment._id, { state: "PAID", transactionId: "test-transaction" });
  const detail = await api.call("detail", { courseId: f.id });
  assert.equal(view.enrollment(detail.myEnrollment).statusLabel, "已支付");
  assert.equal(detail.participants, undefined);
  assert.equal(detail.payment, null);
  const cancelled = await api.call("cancelEnrollment", { courseId: f.id });
  assert.equal(cancelled.enrollment.refund.amountYuan, 67);
  const refund = (await f.repo.scan(C.refund))[0];
  await f.service.runRefund(refund._id);
  f.now += MINUTE;
  await f.service.runRefund(refund._id);
  const mine = await api.call("list", { scope: "mine" });
  assert.equal(view.item(mine.items[0]).myEnrollment.refundLabel, "已全额退款");
  assert.ok(calls.every((call) => call.name === "group_course"));
  assert.equal(calls[2].data.phoneNumber, "vip");
  assert.equal(calls[2].data.authToken, undefined);
});

test("shared login survives time passage, rechecks revoked admin and handles logout", async () => {
  const f = await published();
  const { api, storage } = client(f, "admin");
  storage.set("phoneNumber", "admin");
  const detail = await api.call("detail", { courseId: f.id });
  assert.ok(Array.isArray(detail.participants));
  await f.repo.set("manager", "admin", { phoneNumber: "admin", courtRushManager: 0 });
  await assert.rejects(() => api.call("cancelCourse", { courseId: f.id }), (error) => error.code === "FORBIDDEN");
  f.now += 12 * 60 * MINUTE;
  assert.equal((await api.call("list", { scope: "mine" })).viewer.authenticated, true);
  storage.delete("phoneNumber");
  await assert.rejects(() => api.call("list", { scope: "mine" }), (error) => error.code === "AUTH_REQUIRED");
  assert.equal(api.hasAuth(), false);
});
