const COURSE = 'COURSE'
const RECHARGE_NOTICE = 'RECHARGE_NOTICE'

function courseSubmission(course) {
  return {
    ...course,
    submissionType: COURSE,
    compoundKey: `${COURSE}:${course.id}`,
    collapseKey: `${COURSE}_${course.id}`,
    businessDate: String(course.startTime || '').slice(0, 10),
    submittedAt: course.updatedAt || course.createdAt || ''
  }
}

function rechargeSubmission(notice) {
  return {
    ...notice,
    submissionType: RECHARGE_NOTICE,
    compoundKey: `${RECHARGE_NOTICE}:${notice.id}`,
    collapseKey: `${RECHARGE_NOTICE}_${notice.id}`,
    businessDate: notice.rechargeDate || '',
    submittedAt: notice.updatedAt || notice.createdAt || ''
  }
}

function compareSubmission(left, right) {
  const businessDate = String(right.businessDate).localeCompare(String(left.businessDate))
  if (businessDate) return businessDate
  const submittedAt = String(right.submittedAt).localeCompare(String(left.submittedAt))
  if (submittedAt) return submittedAt
  const type = String(left.submissionType).localeCompare(String(right.submissionType))
  if (type) return type
  return Number(right.id) - Number(left.id)
}

function mergeSubmissions(courses, notices) {
  return [
    ...(Array.isArray(courses) ? courses : []).map(courseSubmission),
    ...(Array.isArray(notices) ? notices : []).map(rechargeSubmission)
  ].sort(compareSubmission)
}

module.exports = { COURSE, RECHARGE_NOTICE, compareSubmission, courseSubmission, mergeSubmissions, rechargeSubmission }
