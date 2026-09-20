const SINGLE_CLASS_COURSE_TYPE = 3
const TEACHING_COURSE_TYPES = new Set([-2, -1, 1, 2, SINGLE_CLASS_COURSE_TYPE])

function equivalentPeople(courseType, quantities, participantCount = 0) {
  const type = Number(courseType)
  if (type === SINGLE_CLASS_COURSE_TYPE) {
    const participants = Number(participantCount)
    return Number.isInteger(participants) && participants > 0 ? participants : 0
  }
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
    equivalentTotalPeople += equivalentPeople(courseType, row.quantities, row.participantCount)
  })

  return {
    month,
    totalCourses,
    totalDuration: Number(totalDuration.toFixed(1)),
    equivalentTotalPeople
  }
}

module.exports = { equivalentPeople, summarizeCourses }
