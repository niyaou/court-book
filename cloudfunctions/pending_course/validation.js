const COURSE_TYPES = new Set([-2, -1, 0, 1, 2])
const timePattern = /^\d{4}-\d{2}-\d{2} (\d{2}):(\d{2}):00$/

function number(value) { return typeof value === 'number' ? value : Number(value) }
function isOneDecimal(value) { return Math.abs(value * 10 - Math.round(value * 10)) < 1e-8 }
function isHalfStep(value) { return Math.abs(value * 2 - Math.round(value * 2)) < 1e-8 }
function minutes(value) {
  const match = timePattern.exec(value || '')
  if (!match) return null
  const hour = Number(match[1]); const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}
function normalizeMember(member) {
  return {
    member_id: number(member.memberId !== undefined ? member.memberId : member.member_id),
    charge: number(member.charge),
    times: number(member.times),
    annual_times: number(member.annualTimes !== undefined ? member.annualTimes : member.annual_times),
    description: number(member.description),
    quantities: number(member.quantities)
  }
}
function validateMember(member) {
  if (!Number.isInteger(member.member_id) || member.member_id <= 0) return '会员无效'
  if (![member.charge, member.times, member.annual_times, member.description].every(Number.isFinite) || !Number.isInteger(member.quantities) || member.quantities <= 0) return '会员消费数据无效'
  if ([member.charge, member.times, member.annual_times, member.description].some(value => value < 0 || !isOneDecimal(value))) return '会员消费数据无效'
  const modes = [member.charge > 0, member.times > 0, member.annual_times > 0].filter(Boolean).length
  if (modes > 1) return '每位会员只能使用一种扣费方式'
  if (member.times > 0 && (member.times < .5 || !isHalfStep(member.times) || member.charge !== 0 || member.annual_times !== 0)) return '次卡扣费无效'
  if (member.annual_times > 0 && (member.annual_times < .5 || !isHalfStep(member.annual_times) || member.charge !== 0 || member.times !== 0)) return '年卡扣费无效'
  if (member.times === 0 && member.annual_times === 0 && member.description !== member.charge) return '课时费说明必须等于扣费金额'
  return ''
}
function normalizeAndValidateCourse(input) {
  const course = input || {}
  const startTime = course.startTime || course.start_time
  const endTime = course.endTime || course.end_time
  const courseType = number(course.courseType !== undefined ? course.courseType : course.course_type)
  const courtId = number(course.courtId !== undefined ? course.courtId : course.court_id)
  const duration = number(course.duration)
  const isAdult = course.isAdult === undefined || course.isAdult === null ? 1 : number(course.isAdult)
  const description = String(course.description || '')
  const startMinutes = minutes(startTime); const endMinutes = minutes(endTime)
  if (!Number.isInteger(courtId) || courtId <= 0 || !COURSE_TYPES.has(courseType)) return { error: '课程类型或校区无效' }
  if (startMinutes === null || endMinutes === null || startTime.slice(0, 10) !== endTime.slice(0, 10) || endMinutes <= startMinutes || startMinutes % 30 || endMinutes % 30) return { error: '课程时间无效' }
  if (!Number.isFinite(duration) || !isHalfStep(duration) || duration !== (endMinutes - startMinutes) / 60) return { error: '课程时长无效' }
  if ((courseType !== 0 && ![0, 1].includes(isAdult)) || (courseType === 0 && isAdult !== 1)) return { error: '成人儿童字段无效' }
  const rawMembers = Array.isArray(course.membersData) ? course.membersData : (Array.isArray(course.members_data) ? course.members_data : [])
  if ((courseType < 0 && rawMembers.length) || (courseType >= 0 && !rawMembers.length)) return { error: courseType < 0 ? '体验课不能填写会员' : '该课程至少需要一位会员' }
  const members = rawMembers.map(normalizeMember)
  const ids = new Set()
  for (const member of members) {
    if (ids.has(member.member_id)) return { error: '同一会员不能重复添加' }
    ids.add(member.member_id)
    const error = validateMember(member)
    if (error) return { error }
  }
  return { course: { courtId, startTime, endTime, duration, courseType, isAdult: courseType === 0 ? 1 : isAdult, description, members } }
}

module.exports = { normalizeAndValidateCourse, normalizeMember, validateMember }
