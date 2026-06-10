// 云函数入口文件
const cloud = require('wx-server-sdk')
const mysql = require('mysql2/promise')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const MEMBER_FIELDS = [
  'id',
  'annual_count',
  'annual_expire_time',
  'name',
  'number',
  'rest_charge',
  'times_count',
  'times_expire_time',
  'court',
  'equivalent_balance',
  'adults',
  'younths',
  'deleted_at'
]

function normalizeInput(value) {
  return String(value || '').trim()
}

function buildSearchSql({ name, number }) {
  const trimmedName = normalizeInput(name)
  const trimmedNumber = normalizeInput(number)
  const where = ['deleted_at IS NULL']
  const params = []

  if (trimmedName) {
    where.push('name LIKE ?')
    params.push(`${trimmedName}%`)
  }

  if (trimmedNumber) {
    where.push('number LIKE ?')
    params.push(`${trimmedNumber}%`)
  }

  return {
    sql: `SELECT ${MEMBER_FIELDS.join(', ')} FROM prepaid_card WHERE ${where.join(' AND ')}`,
    params,
    hasCondition: Boolean(trimmedName || trimmedNumber)
  }
}

function readDbConfig() {
  return {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
  }
}

function hasCompleteDbConfig(dbConfig) {
  return Boolean(dbConfig.host && dbConfig.user && dbConfig.password && dbConfig.database)
}

function hasAccountManagerPermission(manager) {
  return Boolean(manager && Number(manager.accountManager) === 1)
}

async function isAccountManager(db, phoneNumber) {
  const managerRes = await db.collection('manager').where({ phoneNumber }).limit(1).get()
  const manager = managerRes.data && managerRes.data[0]
  return hasAccountManagerPermission(manager)
}

// 云函数入口函数
exports.main = async (event) => {
  const db = cloud.database()
  const operatorPhoneNumber = normalizeInput(event && event.operatorPhoneNumber)
  const name = normalizeInput(event && event.name)
  const number = normalizeInput(event && event.number)

  if (!operatorPhoneNumber) {
    return {
      success: false,
      message: '缺少 operatorPhoneNumber 参数',
      data: []
    }
  }

  let allowed = false
  try {
    allowed = await isAccountManager(db, operatorPhoneNumber)
  } catch (error) {
    console.error('账户管理员权限校验失败:', error)
    return {
      success: false,
      message: '权限校验失败',
      data: []
    }
  }

  if (!allowed) {
    return {
      success: false,
      message: '无权访问，仅限账户管理员',
      data: []
    }
  }

  const query = buildSearchSql({ name, number })
  if (!query.hasCondition) {
    return {
      success: false,
      message: '请至少输入姓名或电话',
      data: []
    }
  }

  const dbConfig = readDbConfig()
  if (!hasCompleteDbConfig(dbConfig)) {
    return {
      success: false,
      message: '数据库配置不完整，请检查环境变量配置',
      data: []
    }
  }

  let connection
  try {
    connection = await mysql.createConnection(dbConfig)
    const [rows] = await connection.execute(query.sql, query.params)
    await connection.end()

    return {
      success: true,
      message: '查询成功',
      data: rows,
      count: rows.length
    }
  } catch (error) {
    if (connection) {
      await connection.end().catch(() => {})
    }

    console.error('会员账户查询失败:', error)
    return {
      success: false,
      message: '查询失败',
      error: error.message,
      data: []
    }
  }
}

exports._test = {
  MEMBER_FIELDS,
  buildSearchSql,
  hasCompleteDbConfig,
  hasAccountManagerPermission
}
