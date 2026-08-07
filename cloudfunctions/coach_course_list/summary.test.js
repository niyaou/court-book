const assert = require('assert')
const { equivalentPeople, summarizeCourses } = require('./summary')

assert.strictEqual(equivalentPeople(1, 1), 1)
assert.strictEqual(equivalentPeople(1, 4), 4)
assert.strictEqual(equivalentPeople(2, 1), 2)
assert.strictEqual(equivalentPeople(2, 2), 2)
assert.strictEqual(equivalentPeople(2, 0), 0)
assert.strictEqual(equivalentPeople(0, 2), 0)
assert.strictEqual(equivalentPeople(-1, 1), 0)
assert.strictEqual(equivalentPeople(3, 1), 0)

assert.deepStrictEqual(summarizeCourses([
  { courseType: -2, duration: 0.5, quantities: 0 },
  { courseType: -1, duration: 1, quantities: 0 },
  { courseType: 0, duration: 2, quantities: 3 },
  { courseType: 1, duration: 1.5, quantities: 4 },
  { courseType: 2, duration: 1, quantities: 1 },
  { courseType: 2, duration: 1, quantities: 0 }
], '2026-08'), {
  month: '2026-08',
  totalCourses: 5,
  totalDuration: 5,
  equivalentTotalPeople: 6
})

console.log('coach_course_list monthly summary tests passed')
