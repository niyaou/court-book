const cloud = require('wx-server-sdk')
const { createConnection } = require('./db')
const { mapNotice } = require('./dto')
const { normalizePage, normalizeStatus, positiveInteger, validateWrite } = require('./validation')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const PAGE_SIZE = 30
const failure = (code, message) => ({ success: false, code, message })
const success = (data, pagination) => ({ success: true, code: 'SUCCESS', data, ...(pagination || {}) })

async function ensureMember(connection, memberId) {
  const [rows] = await connection.execute('SELECT id FROM prepaid_card WHERE id = ? AND deleted_at IS NULL', [memberId])
  return rows.length > 0
}

async function list(connection, coachId, status, requestedPage) {
  const [countRows] = await connection.execute(
    'SELECT COUNT(*) AS total FROM coach_recharge_notice WHERE coach_id = ? AND status = ?',
    [coachId, status]
  )
  const total = Number(countRows[0].total)
  const paged = status === 'ACKNOWLEDGED'
  const totalPages = paged ? Math.ceil(total / PAGE_SIZE) : (total ? 1 : 0)
  const page = paged && totalPages ? Math.min(requestedPage, totalPages) : 1
  const offset = (page - 1) * PAGE_SIZE
  const limit = paged ? `LIMIT ${PAGE_SIZE} OFFSET ${offset}` : ''
  const [rows] = await connection.execute(
    `SELECT n.id,
            n.coach_id AS coachId,
            COALESCE(c.name, '') AS coachName,
            CASE WHEN c.coach_id IS NOT NULL AND c.is_active = 1 AND c.deleted_at IS NULL THEN 1 ELSE 0 END AS coachActive,
            n.member_id AS memberId,
            COALESCE(m.name, '') AS memberName,
            COALESCE(m.number, '') AS memberNumber,
            CASE WHEN m.id IS NOT NULL AND m.deleted_at IS NULL THEN 1 ELSE 0 END AS memberActive,
            DATE_FORMAT(n.recharge_date, '%Y-%m-%d') AS rechargeDate,
            n.note,
            n.status,
            n.version,
            DATE_FORMAT(n.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
            DATE_FORMAT(n.updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt,
            DATE_FORMAT(n.acknowledged_at, '%Y-%m-%d %H:%i:%s') AS acknowledgedAt
       FROM coach_recharge_notice n
       LEFT JOIN coach c ON c.coach_id = n.coach_id
       LEFT JOIN prepaid_card m ON m.id = n.member_id
      WHERE n.coach_id = ? AND n.status = ?
      ORDER BY n.recharge_date DESC, n.updated_at DESC, n.id DESC
      ${limit}`,
    [coachId, status]
  )
  return success(rows.map(mapNotice), {
    page,
    pageSize: paged ? PAGE_SIZE : total,
    total,
    totalPages,
    number: page - 1
  })
}

async function create(connection, coachId, notice) {
  if (!(await ensureMember(connection, notice.memberId))) return failure('VALIDATION_FAILED', '会员不存在或已失效')
  try {
    const [result] = await connection.execute(
      'INSERT INTO coach_recharge_notice (coach_id, member_id, recharge_date, note, status, version) VALUES (?, ?, CURRENT_DATE(), ?, \'PENDING\', 1)',
      [coachId, notice.memberId, notice.note]
    )
    const [rows] = await connection.execute(
      "SELECT DATE_FORMAT(recharge_date, '%Y-%m-%d') AS rechargeDate, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS createdAt, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt FROM coach_recharge_notice WHERE id = ?",
      [result.insertId]
    )
    return success({ id: Number(result.insertId), version: 1, status: 'PENDING', ...rows[0] })
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') return failure('RECHARGE_NOTICE_DUPLICATE', '今天已为该会员上报过充值')
    throw error
  }
}

async function update(connection, coachId, id, notice) {
  if (!(await ensureMember(connection, notice.memberId))) {
    const [existing] = await connection.execute('SELECT member_id FROM coach_recharge_notice WHERE id = ? AND coach_id = ?', [id, coachId])
    if (!existing.length) return failure('RECHARGE_NOTICE_NOT_FOUND', '充值待办已不存在')
    if (Number(existing[0].member_id) !== notice.memberId) return failure('VALIDATION_FAILED', '会员不存在或已失效')
  }
  try {
    const [result] = await connection.execute(
      `UPDATE coach_recharge_notice
          SET member_id = ?, note = ?, status = 'PENDING', version = version + 1,
              acknowledged_at = NULL, updated_at = NOW()
        WHERE id = ? AND coach_id = ? AND version = ?`,
      [notice.memberId, notice.note, id, coachId, notice.version]
    )
    if (!result.affectedRows) {
      const [rows] = await connection.execute('SELECT version FROM coach_recharge_notice WHERE id = ? AND coach_id = ?', [id, coachId])
      return rows.length
        ? failure('RECHARGE_NOTICE_UPDATED', '记录已更新，请刷新后重试')
        : failure('RECHARGE_NOTICE_NOT_FOUND', '充值待办已不存在')
    }
    return success({ id, version: notice.version + 1, status: 'PENDING' })
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') return failure('RECHARGE_NOTICE_DUPLICATE', '今天已为该会员上报过充值')
    throw error
  }
}

exports.main = async (event) => {
  const coachId = positiveInteger(event && event.coachId)
  if (!coachId) return failure('INVALID_COACH', '教练信息无效')
  const action = event && event.action
  let connection
  try {
    connection = await createConnection()
    if (action === 'list') {
      const status = normalizeStatus(event.status)
      if (!status) return failure('VALIDATION_FAILED', '记录状态无效')
      return await list(connection, coachId, status, normalizePage(event.page))
    }
    if (action === 'delete') {
      const id = positiveInteger(event.id)
      if (!id) return failure('VALIDATION_FAILED', '充值待办无效')
      const [result] = await connection.execute(
        "DELETE FROM coach_recharge_notice WHERE id = ? AND coach_id = ? AND status = 'PENDING'",
        [id, coachId]
      )
      if (result.affectedRows) return success({ id })
      const [rows] = await connection.execute('SELECT status FROM coach_recharge_notice WHERE id = ? AND coach_id = ?', [id, coachId])
      return rows.length
        ? failure('RECHARGE_NOTICE_ACKNOWLEDGED', '管理员已知悉的记录不能删除')
        : failure('RECHARGE_NOTICE_NOT_FOUND', '充值待办已不存在')
    }
    if (action === 'create' || action === 'update') {
      const validated = validateWrite(event.notice, action === 'update')
      if (validated.error) return failure('VALIDATION_FAILED', validated.error)
      if (action === 'create') return await create(connection, coachId, validated.value)
      const id = positiveInteger(event.id)
      if (!id) return failure('VALIDATION_FAILED', '充值待办无效')
      return await update(connection, coachId, id, validated.value)
    }
    return failure('VALIDATION_FAILED', '未知操作')
  } catch (error) {
    console.error('recharge_notice failed:', error)
    return failure('DB_ERROR', '操作失败，请稍后重试')
  } finally {
    if (connection) await connection.end().catch(() => {})
  }
}

exports._test = { create, list, mapNotice, update }
