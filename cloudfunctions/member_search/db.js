const mysql = require('mysql2/promise')
const BUSINESS_MYSQL_TIME_ZONE = '+08:00'

async function configureBusinessTimeZone(connection) {
  await connection.execute(`SET time_zone = '${BUSINESS_MYSQL_TIME_ZONE}'`)
  const [rows] = await connection.execute('SELECT @@session.time_zone AS time_zone')
  if (!rows[0] || rows[0].time_zone !== BUSINESS_MYSQL_TIME_ZONE) {
    throw new Error(`unexpected MySQL session time zone: ${rows[0] && rows[0].time_zone}`)
  }
}

exports.createConnection = async () => {
  const config = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE }
  if (!config.host || !config.user || !config.password || !config.database) throw new Error('database configuration is incomplete')
  let connection
  try {
    connection = await mysql.createConnection(config)
    await configureBusinessTimeZone(connection)
    return connection
  } catch (error) {
    if (connection) await connection.end().catch(() => {})
    throw error
  }
}

exports.BUSINESS_MYSQL_TIME_ZONE = BUSINESS_MYSQL_TIME_ZONE
exports.configureBusinessTimeZone = configureBusinessTimeZone
