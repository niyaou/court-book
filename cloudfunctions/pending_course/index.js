const cloud = require('wx-server-sdk')
const { createConnection, placeholders } = require('./db')
const { normalizeAndValidateCourse } = require('./validation')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const failure = (code, message) => ({ success: false, code, message })
const success = (data) => ({ success: true, code: 'SUCCESS', data })

async function ensureReferences(connection, course) {
  const [courts] = await connection.execute('SELECT id FROM court WHERE id = ? AND deleted_at IS NULL', [course.courtId])
  if (!courts.length) return '校区不存在或已失效'
  if (!course.members.length) return ''
  const ids = course.members.map(item => item.member_id)
  const [members] = await connection.execute(`SELECT id FROM prepaid_card WHERE id IN (${placeholders(ids)}) AND deleted_at IS NULL`, ids)
  return members.length === ids.length ? '' : '会员不存在或已失效'
}

function mapMember(member, memberMap) {
  const found = memberMap.get(Number(member.member_id)) || {}
  return {
    memberId: Number(member.member_id), memberName: found.name || '', memberNumber: found.number || '',
    charge: Number(member.charge), times: Number(member.times), annualTimes: Number(member.annual_times),
    description: Number(member.description), quantities: Number(member.quantities),
    restCharge: Number(found.rest_charge || 0), timesCount: Number(found.times_count || 0), annualCount: Number(found.annual_count || 0)
  }
}

async function list(connection, coachId, coachName = '') {
  const [courses] = await connection.execute(
    "SELECT id, court_id, DATE_FORMAT(start_time, '%Y-%m-%d %H:%i:%s') AS start_time, DATE_FORMAT(end_time, '%Y-%m-%d %H:%i:%s') AS end_time, duration, course_type, is_adult, description, members_data, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at FROM pending_course WHERE coach_id = ? ORDER BY start_time DESC, id DESC", [coachId]
  )
  const courtIds = [...new Set(courses.map(item => Number(item.court_id)))]
  const parsed = courses.map((item) => ({ ...item, parsedMembers: typeof item.members_data === 'string' ? JSON.parse(item.members_data) : (item.members_data || []) }))
  const memberIds = [...new Set(parsed.flatMap(item => item.parsedMembers.map(member => Number(member.member_id || member.memberId))))]
  const courtMap = new Map(); const memberMap = new Map()
  if (courtIds.length) {
    const [courts] = await connection.execute(`SELECT id, name FROM court WHERE id IN (${placeholders(courtIds)}) AND deleted_at IS NULL`, courtIds)
    courts.forEach(item => courtMap.set(Number(item.id), item))
  }
  if (memberIds.length) {
    const [members] = await connection.execute(`SELECT id, name, number, rest_charge, times_count, annual_count FROM prepaid_card WHERE id IN (${placeholders(memberIds)}) AND deleted_at IS NULL`, memberIds)
    members.forEach(item => memberMap.set(Number(item.id), item))
  }
  return parsed.map(item => ({
    id: Number(item.id), coachId: Number(coachId), coachName, courtId: Number(item.court_id), courtName: (courtMap.get(Number(item.court_id)) || {}).name || '',
    startTime: item.start_time, endTime: item.end_time, duration: Number(item.duration), courseType: Number(item.course_type), isAdult: Number(item.is_adult), description: item.description || '',
    membersData: item.parsedMembers.map(member => mapMember({
      member_id: member.member_id !== undefined ? member.member_id : member.memberId,
      charge: member.charge, times: member.times,
      annual_times: member.annual_times !== undefined ? member.annual_times : member.annualTimes,
      description: member.description, quantities: member.quantities
    }, memberMap)),
    createdAt: item.created_at, updatedAt: item.updated_at
  }))
}

async function create(connection, coachId, course) {
  await connection.beginTransaction()
  try {
    const [pending] = await connection.execute('SELECT id FROM pending_course WHERE coach_id = ? AND start_time = ? AND end_time = ? LIMIT 1', [coachId, course.startTime, course.endTime])
    if (pending.length) { await connection.rollback(); return failure('COURSE_DUPLICATE', '已有相同时间的待审课程') }
    const [formal] = await connection.execute('SELECT id FROM course WHERE coach_id = ? AND start_time = ? AND end_time = ? AND deleted_at IS NULL LIMIT 1', [coachId, course.startTime, course.endTime])
    if (formal.length) { await connection.rollback(); return failure('COURSE_DUPLICATE', '已有相同时间的正式课程') }
    const referenceError = await ensureReferences(connection, course)
    if (referenceError) { await connection.rollback(); return failure('VALIDATION_FAILED', referenceError) }
    const [result] = await connection.execute(
      'INSERT INTO pending_course (coach_id, court_id, start_time, end_time, duration, course_type, is_adult, description, members_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [coachId, course.courtId, course.startTime, course.endTime, course.duration, course.courseType, course.isAdult, course.description, JSON.stringify(course.members)]
    )
    const [created] = await connection.execute("SELECT DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at FROM pending_course WHERE id = ?", [result.insertId])
    await connection.commit()
    return success({ id: Number(result.insertId), updatedAt: created[0].updated_at })
  } catch (error) { await connection.rollback(); throw error }
}

async function update(connection, coachId, id, course) {
  const referenceError = await ensureReferences(connection, course)
  if (referenceError) return failure('VALIDATION_FAILED', referenceError)
  const [result] = await connection.execute(
    'UPDATE pending_course SET court_id = ?, start_time = ?, end_time = ?, duration = ?, course_type = ?, is_adult = ?, description = ?, members_data = ?, updated_at = NOW() WHERE id = ? AND coach_id = ?',
    [course.courtId, course.startTime, course.endTime, course.duration, course.courseType, course.isAdult, course.description, JSON.stringify(course.members), id, coachId]
  )
  if (!result.affectedRows) return failure('PENDING_NOT_FOUND', '课程已被管理员录取或已不存在')
  const [rows] = await connection.execute("SELECT DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at FROM pending_course WHERE id = ?", [id])
  return success({ id: Number(id), updatedAt: rows[0].updated_at })
}

exports.main = async (event) => {
  const coachId = Number(event && event.coachId)
  if (!Number.isInteger(coachId) || coachId <= 0) return failure('INVALID_COACH', '教练信息无效')
  const action = event && event.action
  let connection
  try {
    connection = await createConnection()
    if (action === 'list') return success(await list(connection, coachId))
    if (action === 'delete') {
      const id = Number(event.id)
      if (!Number.isInteger(id) || id <= 0) return failure('VALIDATION_FAILED', '课程无效')
      const [result] = await connection.execute('DELETE FROM pending_course WHERE id = ? AND coach_id = ?', [id, coachId])
      return result.affectedRows ? success({ id }) : failure('PENDING_NOT_FOUND', '课程已被管理员录取或已不存在')
    }
    if (action === 'create' || action === 'update') {
      const validated = normalizeAndValidateCourse(event.course)
      if (validated.error) return failure('VALIDATION_FAILED', validated.error)
      if (action === 'create') return await create(connection, coachId, validated.course)
      const id = Number(event.id)
      if (!Number.isInteger(id) || id <= 0) return failure('VALIDATION_FAILED', '课程无效')
      return await update(connection, coachId, id, validated.course)
    }
    return failure('VALIDATION_FAILED', '未知操作')
  } catch (error) {
    console.error('pending_course failed:', error)
    return failure('DB_ERROR', '操作失败，请稍后重试')
  } finally {
    if (connection) await connection.end().catch(() => {})
  }
}

exports._test = { list, mapMember }
