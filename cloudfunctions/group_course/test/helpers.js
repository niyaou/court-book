"use strict";
const assert = require("node:assert/strict");
const { createService } = require("../lib/service");
const { C, MINUTE, hash, BusinessError, beijing, fee } = require("../lib/core");
const { paymentResult, refundResult } = require("../lib/gateway");
const { createRepository } = require("../lib/repository");
const clone = (x) => (x == null ? null : structuredClone(x));
class MemoryRepository {
  constructor() {
    this.rows = new Map();
    this.versions = new Map();
    this.failWrite = null;
  }
  key(n, id) {
    return n + "/" + id;
  }
  async get(n, id) {
    return clone(this.rows.get(this.key(n, id)));
  }
  async set(n, id, value) {
    const k = this.key(n, id);
    this.rows.set(k, { ...clone(value), _id: id });
    this.versions.set(k, (this.versions.get(k) || 0) + 1);
  }
  async scan(n, where = {}) {
    return [...this.rows.entries()]
      .filter(
        ([k, v]) =>
          k.startsWith(n + "/") &&
          Object.entries(where).every(([f, w]) => v[f] === w),
      )
      .map(([, v]) => clone(v))
      .sort((a, b) => a._id.localeCompare(b._id));
  }
  async transaction(fn) {
    const reads = new Map(),
      writes = new Map();
    const tx = {
      get: async (n, id) => {
        const k = this.key(n, id);
        reads.set(k, this.versions.get(k) || 0);
        return clone(writes.get(k) || this.rows.get(k));
      },
      set: async (n, id, v) => {
        const k = this.key(n, id);
        if (this.failWrite && this.failWrite(n, id, v))
          throw Error("SIMULATED_INTERRUPTION");
        if (!reads.has(k)) reads.set(k, this.versions.get(k) || 0);
        writes.set(k, { ...clone(v), _id: id });
      },
    };
    const result = await fn(tx);
    for (const [k, v] of reads)
      if ((this.versions.get(k) || 0) !== v)
        throw new BusinessError("RETRYABLE_CONFLICT", "conflict", true);
    for (const [k, v] of writes) {
      this.rows.set(k, v);
      this.versions.set(k, (this.versions.get(k) || 0) + 1);
    }
    return result;
  }
}
async function fixture() {
  const repo = new MemoryRepository();
  // Default course starts at 18:00; keep the fixture outside the 12-hour cutoff.
  let now = Date.parse("2026-09-06T04:00:00+08:00");
  const calls = { create: 0, submit: 0, query: 0 };
  const gateway = {
    createPayment: async () => {
      calls.create++;
      return {
        state: "CREATED",
        paymentParams: {
          timeStamp: "1",
          nonceStr: "nonce",
          package: "prepay_id=test",
          signType: "RSA",
          paySign: "signature",
        },
      };
    },
    queryPayment: async () => ({ state: "UNPAID" }),
    submitRefund: async () => {
      calls.submit++;
      return { state: "PROCESSING" };
    },
    queryRefund: async () => {
      calls.query++;
      return { state: "SUCCESS", refundId: "wx-refund" };
    },
  };
  const service = createService({
    repo,
    gateway,
    vip: async (p) => p === "vip",
    clock: () => now,
    logger: { error() {}, warn() {} },
  });
  await repo.set("manager", "admin", {
    phoneNumber: "admin",
    courtRushManager: 1,
  });
  await repo.set("campus", "campus", {
    name: "东区",
    enabled: true,
    bookingManaged: true,
  });
  await repo.set("court", "court", { campus: "东区", courtNumber: "1" });
  await repo.set("manager", "coach", {
    name: "教练",
    phoneNumber: "coach-phone",
  });
  await repo.set("group_course_template", "template", {
    title: "模板",
    description: "内容",
    enabled: true,
  });
  const request = (phone, action, input = {}) =>
    service.handle(
      { action, ...input, ...(phone ? { phoneNumber: phone } : {}) },
      { OPENID: phone ? "openid-" + phone : "" },
    );
  const publish = (overrides = {}) =>
    request("admin", "publish", {
      publishRequestId: "request_1234567890",
      templateId: "template",
      title: "发球课",
      description: "管理员确认后的内容",
      coachId: "coach",
      campus: "东区",
      courtId: "court",
      startAt: Date.parse("2026-09-06T18:00:00+08:00"),
      endAt: Date.parse("2026-09-06T19:00:00+08:00"),
      priceYuan: 101,
      vipPriceYuan: 67,
      minParticipants: 1,
      maxParticipants: 2,
      ...overrides,
    });
  return {
    repo,
    service,
    gateway,
    calls,
    request,
    publish,
    get now() {
      return now;
    },
    set now(v) {
      now = v;
    },
  };
}
async function published() {
  const f = await fixture();
  const r = await f.publish();
  assert.equal(r.success, true, JSON.stringify(r));
  f.id = r.data.courseId;
  return f;
}
async function paid(f, phone = "user") {
  const en = await f.request(phone, "enroll", { courseId: f.id });
  assert.equal(en.success, true, JSON.stringify(en));
  const p = (
    await f.repo.scan(C.payment, { enrollmentId: en.data.enrollment.id })
  ).at(-1);
  await f.service.confirmPayment(p._id, {
    state: "PAID",
    transactionId: "wx-tx",
  });
  return { en: await f.repo.get(C.enrollment, en.data.enrollment.id), p };
}

module.exports = { MemoryRepository, fixture, published, paid };
