const TEACHING_COURSE_TYPES = new Set([-2, -1, 1, 2])

function equivalentPeople(courseType, quantities) {
  const type = Number(courseType)
  const people = Number(quantities)
  if (![1, 2].includes(type) || !Number.isFinite(people) || people <= 0) return 0
  return people > 1 ? people : type * people
}

function summarizeCourses(rows, month) {
  let totalCourses = 0
  let totalDuration = 0
  let equivalentTotalPeople = 0

  ;(rows || []).forEach(row => {
    const courseType = Number(row.courseType)
    if (!TEACHING_COURSE_TYPES.has(courseType)) return
    totalCourses += 1
    const duration = Number(row.duration)
    if (Number.isFinite(duration)) totalDuration += duration
    equivalentTotalPeople += equivalentPeople(courseType, row.quantities)
  })

  return {
    month,
    totalCourses,
    totalDuration: Number(totalDuration.toFixed(1)),
    equivalentTotalPeople
  }
}

module.exports = { equivalentPeople, summarizeCourses }
