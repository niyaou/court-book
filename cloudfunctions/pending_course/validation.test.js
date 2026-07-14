const assert = require('assert')
const { normalizeAndValidateCourse } = require('./validation')
const base = { courtId: 1, startTime: '2026-07-12 09:00:00', endTime: '2026-07-12 10:00:00', duration: 1, courseType: 1, isAdult: 1, membersData: [{ memberId: 3, charge: 0, times: .5, annualTimes: 0, description: 100, quantities: 1 }] }
assert.ok(normalizeAndValidateCourse(base).course)
assert.ok(normalizeAndValidateCourse({ ...base, endTime: '2026-07-13 10:00:00' }).error)
assert.ok(normalizeAndValidateCourse({ ...base, membersData: [{ ...base.membersData[0], times: .3 }] }).error)
assert.ok(normalizeAndValidateCourse({ ...base, courseType: -1, membersData: [] }).course)
console.log('pending_course validation tests passed')
