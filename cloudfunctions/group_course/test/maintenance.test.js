"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { C, MINUTE } = require("../lib/core");
const { createRepository } = require("../lib/repository");
const { published, paid } = require("./helpers");

test("idle maintenance reads no future courses, historical payments or terminal refunds", async () => {
  const f = await published();
  const base = await f.repo.get(C.course, f.id);
  for (let i = 0; i < 120; i++) {
    await f.repo.set(C.course, `future-${i}`, { ...base, startAt: new Date(f.now + 58 * MINUTE) });
    await f.repo.set(C.course, `confirmed-${i}`, { ...base, status: "CONFIRMED", endAt: new Date(f.now + 1) });
    await f.repo.set(C.course, `complete-${i}`, { ...base, status: "COMPLETED" });
    await f.repo.set(C.course, `clean-${i}`, { ...base, status: "CANCELLED", cancellationCleanupCompleted: true });
    await f.repo.set(C.payment, `paid-${i}`, { status: "PAIDED", queryNextAt: null });
    await f.repo.set(C.payment, `later-${i}`, { status: "PENDING", queryNextAt: new Date(f.now + 1) });
    await f.repo.set(C.refund, `success-${i}`, { status: "SUCCESS", nextRetryAt: new Date(f.now - MINUTE) });
    await f.repo.set(C.refund, `stopped-${i}`, { status: "FAILED", nextRetryAt: null });
    await f.repo.set(C.refund, `later-${i}`, { status: "PROCESSING", nextRetryAt: new Date(f.now + 1) });
  }
  const queries = [];
  const findDue = f.repo.findDue.bind(f.repo);
  f.repo.findDue = async (...args) => {
    const rows = await findDue(...args);
    queries.push({ collection: args[0], count: rows.length });
    return rows;
  };
  f.repo.scan = async () => assert.fail("idle scheduler must not scan a collection");
  f.repo.transaction = async () => assert.fail("idle scheduler must not open a transaction");
  const result = await f.service.maintenance({ Type: "timer" }, {});
  assert.equal(queries.length, 6);
  assert.equal(queries.reduce((sum, q) => sum + q.count, 0), 0);
  assert.deepEqual(result, { processedCourses: 0, processedRefunds: 0 });
});

test("bounded formation batches rotate past failed records and include the exact deadline", async () => {
  const f = await published();
  const base = await f.repo.get(C.course, f.id);
  for (let i = 0; i < 61; i++) {
    await f.repo.set(C.course, `due-${String(i).padStart(2, "0")}`, {
      ...base, startAt: new Date(f.now + 57 * MINUTE),
    });
  }
  // Reservation succeeds, but settlement fails. The next batch must reach untouched rows.
  f.repo.failWrite = (name, id, row) => name === C.course && id.startsWith("due-") && row.status !== "PUBLISHED";
  const sizes = [];
  const findDue = f.repo.findDue.bind(f.repo);
  f.repo.findDue = async (...args) => {
    const rows = await findDue(...args);
    sizes.push(rows.length);
    return rows;
  };
  const first = await f.service.maintenance({ Type: "timer" }, {});
  assert.equal(first.processedCourses, 50);
  f.now += MINUTE;
  await f.service.maintenance({ Type: "timer" }, {});
  const attempted = (await f.repo.scan(C.course)).filter(c => c._id.startsWith("due-") && c.maintenanceAt);
  assert.equal(attempted.length, 61);
  assert.ok(sizes.every(size => size <= 50));
});

test("pending payment batches rotate without losing unresolved payments", async () => {
  const f = await published();
  await f.request("user", "enroll", { courseId: f.id });
  const base = (await f.repo.scan(C.payment))[0];
  for (let i = 0; i < 60; i++) await f.repo.set(C.payment, `pending-${i}`, { ...base, queryNextAt: null });
  const queried = new Set();
  f.gateway.queryPayment = async p => { queried.add(p._id); return { state: "UNKNOWN" }; };
  await f.service.maintenance({ Type: "timer" }, {});
  assert.equal(queried.size, 50);
  f.now += MINUTE;
  await f.service.maintenance({ Type: "timer" }, {});
  assert.equal(queried.size, 61);
  assert.equal((await f.repo.scan(C.payment, { status: "PENDING" })).length, 61);
});

test("expired holds are released even when payment queries are deferred behind old unresolved records", async () => {
  const f = await published();
  const en = await f.request("user", "enroll", { courseId: f.id });
  const payment = (await f.repo.scan(C.payment))[0];
  for (let i = 0; i < 60; i++) {
    await f.repo.set(C.payment, `old-${i}`, {
      ...payment, courseId: `old-course-${i}`, createdAt: new Date(f.now - 10 * MINUTE),
      queryNextAt: new Date(f.now + 60 * MINUTE),
    });
  }
  await f.repo.set(C.payment, payment._id, { ...payment, queryNextAt: new Date(f.now + 60 * MINUTE) });
  f.now += 3 * MINUTE;
  f.gateway.queryPayment = async () => assert.fail("deferred payments must not be queried");
  await f.service.maintenance({ Type: "timer" }, {});
  assert.equal((await f.repo.get(C.enrollment, en.data.enrollment.id)).status, "EXPIRED");
  assert.equal((await f.repo.get(C.payment, payment._id)).status, "EXPIRED");
});

test("refund selection excludes active leases, completed and paused records but includes due retries", async () => {
  const f = await published();
  await paid(f);
  await f.request("user", "cancelEnrollment", { courseId: f.id });
  const r = (await f.repo.scan(C.refund))[0];
  await f.repo.set(C.refund, "leased", { ...r, leaseUntil: new Date(f.now + 1) });
  await f.repo.set(C.refund, "success", { ...r, status: "SUCCESS" });
  await f.repo.set(C.refund, "stopped", { ...r, status: "FAILED", nextRetryAt: null });
  await f.repo.set(C.refund, "later", { ...r, nextRetryAt: new Date(f.now + 1) });
  const missing = { ...r, status: "FAILED" };
  delete missing.nextRetryAt;
  await f.repo.set(C.refund, "missing-deadline", missing);
  // Retryable FAILED remains eligible; the exact lease deadline is inclusive.
  await f.repo.set(C.refund, r._id, { ...r, status: "FAILED", leaseUntil: new Date(f.now) });
  const selected = [];
  const findDue = f.repo.findDue.bind(f.repo);
  f.repo.findDue = async (...args) => {
    const rows = await findDue(...args);
    if (args[0] === C.refund) selected.push(...rows.map(row => row._id));
    return rows;
  };
  await f.service.maintenance({ Type: "timer" }, {});
  assert.deepEqual(selected, [r._id]);
  assert.equal(f.calls.submit, 1);
});

test("repository sends deadline/null filters, stable sorting and a hard limit to CloudBase", async () => {
  const commands = {};
  for (const op of ["and", "or", "in", "exists", "eq", "neq", "lte"])
    commands[op] = (...values) => ({ op, values });
  let filter, limit, reads = 0;
  const ordering = [];
  const query = {
    where(value) { filter = value; return this; },
    orderBy(field, direction) { ordering.push([field, direction]); return this; },
    limit(value) { limit = value; return this; },
    async get() { reads++; return { data: [] }; },
  };
  const repo = createRepository({ command: commands, collection: () => query });
  const now = new Date();
  await repo.findDue(C.refund, {
    where: { status: ["PENDING", "PROCESSING", "FAILED"] },
    before: { nextRetryAt: now }, optionalBefore: { leaseUntil: now },
    orderBy: ["nextRetryAt", "_id"],
  });
  assert.equal(reads, 1);
  assert.equal(limit, 50);
  assert.deepEqual(ordering, [["nextRetryAt", "asc"], ["_id", "asc"]]);
  assert.deepEqual(filter, commands.and(
    { status: commands.in(["PENDING", "PROCESSING", "FAILED"]) },
    { nextRetryAt: commands.exists(true) }, { nextRetryAt: commands.neq(null) },
    { nextRetryAt: commands.lte(now) },
    commands.or({ leaseUntil: commands.exists(false) }, { leaseUntil: commands.eq(null) },
      { leaseUntil: commands.lte(now) }),
  ));
});
