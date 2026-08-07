const assert = require('assert')
const { mergeSubmissions } = require('./submissions')

const merged = mergeSubmissions(
  [{ id: 4, startTime: '2026-08-07 10:00:00', updatedAt: '2026-08-07 09:00:00' }],
  [
    { id: 4, rechargeDate: '2026-08-07', updatedAt: '2026-08-07 11:00:00' },
    { id: 1, rechargeDate: '2026-08-06', updatedAt: '2026-08-07 12:00:00' }
  ]
)

assert.deepStrictEqual(merged.map(item => item.compoundKey), [
  'RECHARGE_NOTICE:4',
  'COURSE:4',
  'RECHARGE_NOTICE:1'
])
assert.strictEqual(merged[0].businessDate, '2026-08-07')
assert.strictEqual(merged[0].submittedAt, '2026-08-07 11:00:00')

console.log('coach submission merge tests passed')
