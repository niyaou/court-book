const cloud = require('wx-server-sdk')
const mysql = require('mysql2/promise')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const BUSINESS_MYSQL_TIME_ZONE = '+08:00'

async function configureBusinessTimeZone(connection) {
  await connection.execute(`SET time_zone = '${BUSINESS_MYSQL_TIME_ZONE}'`)
  const [rows] = await connection.execute('SELECT @@session.time_zone AS time_zone')
  if (!rows[0] || rows[0].time_zone !== BUSINESS_MYSQL_TIME_ZONE) {
    throw new Error(`unexpected MySQL session time zone: ${rows[0] && rows[0].time_zone}`)
  }
}

function config() {
  return { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE }
}

exports.main = async (event) => {
  const phoneNumber = String((event && event.phoneNumber) || '').trim()
  if (!phoneNumber) return { success: true, isCoach: false }
  let connection
  try {
    const manager = await cloud.database().collection('manager').where({ phoneNumber }).limit(1).get()
    if (!manager.data || !manager.data.length) return { success: true, isCoach: false }
    const dbConfig = config()
    if (!dbConfig.host || !dbConfig.user || !dbConfig.password || !dbConfig.database) throw new Error('database configuration is incomplete')
    connection = await mysql.createConnection(dbConfig)
    await configureBusinessTimeZone(connection)
    const [coaches] = await connection.execute(
      'SELECT coach_id AS id, name, number FROM coach WHERE number = ? AND is_active = 1 AND deleted_at IS NULL LIMIT 1', [phoneNumber]
    )
    if (!coaches.length) return { success: true, isCoach: false }
    const [courts] = await connection.execute('SELECT id, name FROM court WHERE deleted_at IS NULL ORDER BY id ASC')
    const coach = coaches[0]
    return {
      success: true,
      isCoach: true,
      data: {
        coach,
        courts
      }
    }
  } catch (error) {
    console.error('coach_context failed:', error)
    return { success: false, message: '初始化失败' }
  } finally {
    if (connection) await connection.end().catch(() => {})
  }
}

exports._test = { BUSINESS_MYSQL_TIME_ZONE, configureBusinessTimeZone }
