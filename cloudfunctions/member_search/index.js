const cloud = require('wx-server-sdk')
const { createConnection } = require('./db')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function escapeLike(keyword) { return keyword.replace(/[\\%_]/g, '\\$&') }
exports.main = async (event) => {
  const keyword = String((event && event.keyword) || '').trim()
  if (!keyword) return { success: true, code: 'SUCCESS', data: [] }
  let connection
  try {
    connection = await createConnection()
    const [rows] = await connection.execute(
      "SELECT id, name, number, rest_charge AS restCharge, times_count AS timesCount, annual_count AS annualCount FROM prepaid_card WHERE deleted_at IS NULL AND name LIKE ? ESCAPE '\\\\' ORDER BY name ASC, id ASC LIMIT 20",
      [`%${escapeLike(keyword)}%`]
    )
    return { success: true, code: 'SUCCESS', data: rows }
  } catch (error) {
    console.error('member_search failed:', error)
    return { success: false, code: 'DB_ERROR', message: '会员搜索失败' }
  } finally { if (connection) await connection.end().catch(() => {}) }
}
exports._test = { escapeLike }
