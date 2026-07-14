const assert = require('assert')
const { businessYearMonth, rangeForCurrentThreeMonths } = require('./date_range')

function assertRange(isoTime, expected) {
  assert.deepStrictEqual(rangeForCurrentThreeMonths(new Date(isoTime)), expected)
}

// These UTC instants straddle a China business-month boundary.
assert.deepStrictEqual(businessYearMonth(new Date('2026-06-30T16:00:00.000Z')), { year: 2026, month: 7 })
assertRange('2026-06-30T15:59:59.000Z', { start: '2026-04-01 00:00:00', end: '2026-07-01 00:00:00' })
assertRange('2026-06-30T16:00:00.000Z', { start: '2026-05-01 00:00:00', end: '2026-08-01 00:00:00' })
assertRange('2026-12-31T16:00:00.000Z', { start: '2026-11-01 00:00:00', end: '2027-02-01 00:00:00' })
assertRange('2027-02-01T00:00:00.000Z', { start: '2026-12-01 00:00:00', end: '2027-03-01 00:00:00' })

console.log('coach_course_list Asia/Shanghai month-boundary tests passed')
