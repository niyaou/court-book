const test = require('node:test');
const assert = require('node:assert/strict');
const { canProcessCancelledRush } = require('./refund-policy');

test('rejects a missing rush', () => {
  assert.equal(canProcessCancelledRush(null, false), false);
  assert.equal(canProcessCancelledRush(null, true), false);
});

test('allows the initial cancellation only before the rush is soft-deleted', () => {
  assert.equal(canProcessCancelledRush({ deleted_at: null }, false), true);
  assert.equal(canProcessCancelledRush({ deleted_at: new Date() }, false), false);
});

test('allows an internal refund batch to continue after soft deletion', () => {
  assert.equal(canProcessCancelledRush({ deleted_at: new Date() }, true), true);
});
