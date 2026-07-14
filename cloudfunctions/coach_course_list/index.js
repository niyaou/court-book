const cloud = require('wx-server-sdk')
const { createConnection, placeholders } = require('./db')
const { rangeForCurrentThreeMonths } = require('./date_range')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const PAGE_SIZE = 30
exports.main = async (event) => {
  const coachId = Number(event && event.coachId)
  if (!Number.isInteger(coachId) || coachId <= 0) return { success: false, code: 'INVALID_COACH', message: '教练信息无效' }
  const page = Math.max(1, Number.parseInt(event && event.page, 10) || 1)
  const { start, end } = rangeForCurrentThreeMonths()
  let connection
  try {
    connection = await createConnection()
    const [countRows] = await connection.execute('SELECT COUNT(*) AS total FROM course WHERE coach_id = ? AND start_time >= ? AND start_time < ? AND deleted_at IS NULL', [coachId, start, end])
    const total = Number(countRows[0].total); const totalPages = Math.ceil(total / PAGE_SIZE)
    const effectivePage = totalPages ? Math.min(page, totalPages) : 1
    const offset = (effectivePage - 1) * PAGE_SIZE
    const [courses] = await connection.execute(
      `SELECT c.id, c.court_id AS courtId, COALESCE(ct.name, '') AS courtName, DATE_FORMAT(c.start_time, '%Y-%m-%d %H:%i:%s') AS startTime, DATE_FORMAT(c.end_time, '%Y-%m-%d %H:%i:%s') AS endTime, c.duration, c.course_type AS courseType, c.is_adult AS isAdult, c.description FROM course c LEFT JOIN court ct ON ct.id = c.court_id AND ct.deleted_at IS NULL WHERE c.coach_id = ? AND c.start_time >= ? AND c.start_time < ? AND c.deleted_at IS NULL ORDER BY c.start_time DESC, c.id DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      [coachId, start, end]
    )
    const ids = courses.map(item => item.id)
    const byCourse = new Map(ids.map(id => [Number(id), []]))
    if (ids.length) {
      const [members] = await connection.execute(
        `SELECT cm.course_id AS courseId, pc.id AS memberId, pc.name AS memberName, pc.number AS memberNumber, COALESCE(s.charge, 0) AS charge, COALESCE(s.times, 0) AS times, COALESCE(s.annual_times, 0) AS annualTimes, COALESCE(s.description, 0) AS description, COALESCE(s.quantities, 1) AS quantities FROM course_member cm JOIN prepaid_card pc ON pc.id = cm.member_id LEFT JOIN spend s ON s.course_id = cm.course_id AND s.prepaid_card_id = cm.member_id AND s.deleted_at IS NULL WHERE cm.course_id IN (${placeholders(ids)}) ORDER BY cm.course_id, pc.id`, ids
      )
      members.forEach(member => byCourse.get(Number(member.courseId)).push(member))
    }
    return { success: true, code: 'SUCCESS', data: courses.map(course => ({ ...course, id: Number(course.id), duration: Number(course.duration), courseType: Number(course.courseType), isAdult: Number(course.isAdult), membersData: byCourse.get(Number(course.id)) || [] })), page: effectivePage, pageSize: PAGE_SIZE, total, totalPages }
  } catch (error) {
    console.error('coach_course_list failed:', error)
    return { success: false, code: 'DB_ERROR', message: '正式课查询失败' }
  } finally { if (connection) await connection.end().catch(() => {}) }
}
exports._test = { rangeForCurrentThreeMonths }
