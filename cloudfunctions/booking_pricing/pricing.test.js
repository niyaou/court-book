const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculatePricing,
  calculateSlotFee,
  normalizeLightingRule,
  selectEffectiveRule,
} = require('./pricing');

function makeRule(overrides = {}) {
  return {
    _id: 'summer-2026',
    type: 'BOOKING_PRICING',
    schema_version: 1,
    status: 'PUBLISHED',
    effective_from: '20260718',
    lighting_fee: {
      enabled: true,
      start_time: '19:30',
      fee_per_slot_yuan: 10,
    },
    campus_overrides: [],
    ...overrides,
  };
}

test('selects the latest published rule effective on the booking date', () => {
  const winter = makeRule({ _id: 'winter', effective_from: '20260101' });
  const summer = makeRule({ _id: 'summer', effective_from: '20260718' });
  assert.equal(selectEffectiveRule([summer, winter], '20260717')._id, 'winter');
  assert.equal(selectEffectiveRule([winter, summer], '20260718')._id, 'summer');
});

test('charges 19:30 itself but not 19:00', () => {
  const rule = normalizeLightingRule(makeRule(), '麓坊校区');
  assert.equal(calculateSlotFee('19:00', rule), 0);
  assert.equal(calculateSlotFee('19:30', rule), 10);
  assert.equal(calculateSlotFee('20:00', rule), 10);
});

test('uses a campus override before the default rule', () => {
  const row = makeRule({
    campus_overrides: [{
      campus: '桐梓林校区',
      lighting_fee: { start_time: '18:30', fee_per_slot_yuan: 12 },
    }],
  });
  const rule = normalizeLightingRule(row, '桐梓林校区');
  assert.equal(rule.start_time, '18:30');
  assert.equal(rule.fee_per_slot_yuan, 12);
});

test('supports a season with lighting fees disabled', () => {
  const rule = normalizeLightingRule(makeRule({
    lighting_fee: { enabled: false },
  }), '雅居乐校区');
  assert.equal(calculateSlotFee('23:30', rule), 0);
  assert.equal(rule.notice, '当前预约日期不收取灯光费');
});

test('calculates each slot and total without floating point drift', () => {
  const rule = normalizeLightingRule(makeRule({
    lighting_fee: { enabled: true, start_time: '19:30', fee_per_slot_yuan: 10.5 },
  }), '麓坊校区');
  const result = calculatePricing([
    { date: '20260718', start_time: '19:00' },
    { date: '20260718', start_time: '19:30' },
    { date: '20260718', start_time: '20:00' },
  ], { 20260718: rule });
  assert.deepEqual(result.slots.map((slot) => slot.lighting_fee_yuan), [0, 10.5, 10.5]);
  assert.equal(result.total_lighting_fee_yuan, 21);
});

test('rejects missing, malformed, and duplicate configurations', () => {
  assert.throws(() => selectEffectiveRule([], '20260718'), { code: 'PRICING_CONFIG_NOT_FOUND' });
  assert.throws(() => selectEffectiveRule([makeRule()], '20260230'), { code: 'INVALID_PRICING_INPUT' });
  assert.throws(() => normalizeLightingRule(makeRule({
    lighting_fee: { enabled: true, start_time: '19:15', fee_per_slot_yuan: 10 },
  }), '麓坊校区'), { code: 'INVALID_PRICING_CONFIG' });
  assert.throws(() => normalizeLightingRule(makeRule({
    lighting_fee: { enabled: true, start_time: '19:30', fee_per_slot_yuan: '10' },
  }), '麓坊校区'), { code: 'INVALID_PRICING_CONFIG' });
  assert.throws(() => normalizeLightingRule(makeRule({
    campus_overrides: [
      { campus: '麓坊校区', lighting_fee: {} },
      { campus: '麓坊校区', lighting_fee: {} },
    ],
  }), '麓坊校区'), { code: 'INVALID_PRICING_CONFIG' });
});
