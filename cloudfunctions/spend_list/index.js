// 云函数入口文件
const cloud = require('wx-server-sdk')
const mysql = require('mysql2/promise')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

// 云函数入口函数
// 需要在微信云开发控制台的云函数配置中添加以下环境变量：
// DB_HOST: 数据库主机地址
// DB_PORT: 数据库端口（默认 3306）
// DB_USER: 数据库用户名
// DB_PASSWORD: 数据库密码
// DB_DATABASE: 数据库名称
exports.main = async (event, context) => {
  const { phoneNumber, page = 1, pageSize = 20 } = event

  // 参数校验
  if (!phoneNumber) {
    return {
      success: false,
      message: '缺少 phoneNumber 参数'
    }
  }

  // 分页参数校验
  const currentPage = Math.max(1, parseInt(page) || 1)
  const limit = Math.max(1, Math.min(100, parseInt(pageSize) || 20))
  const offset = Math.max(0, (currentPage - 1) * limit)

  console.log('查询参数:', { phoneNumber, page, pageSize, currentPage, limit, offset })

  // 从环境变量读取数据库配置
  const dbConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
  }

  // 检查必要的环境变量
  if (!dbConfig.host || !dbConfig.user || !dbConfig.password || !dbConfig.database) {
    return {
      success: false,
      message: '数据库配置不完整，请检查环境变量配置'
    }
  }

  let connection
  try {
    // 连接数据库
    connection = await mysql.createConnection(dbConfig)

    // 查询总记录数
    console.log('开始查询总记录数')
    const [countResult] = await connection.execute(
      `SELECT COUNT(*) as total
      FROM spend s
      JOIN prepaid_card pc ON s.prepaid_card_id = pc.id
      WHERE pc.number = ?`,
      [phoneNumber]
    )
    const total = countResult[0].total
    console.log('总记录数:', total)

    // 通过 phoneNumber 查询消费记录（使用 JOIN 查询拼接完整信息，分页）
    // LIMIT 和 OFFSET 直接拼接，避免预处理语句参数问题
    const sql = `SELECT 
        s.id,
        s.charge,
        s.times,
        s.annual_times,
        s.description as spend_description,
        s.quantities,
        pc.name as member_name,
        pc.court as member_court,
        c.id as course_id,
        DATE_FORMAT(c.start_time, '%Y-%m-%d %H:%i:%s') as course_start_time,
        DATE_FORMAT(c.end_time, '%Y-%m-%d %H:%i:%s') as course_end_time,
        c.duration,
        c.course_type,
        c.is_adult,
        c.description as course_description,
        ct.name as court_name,
        co.name as coach_name
      FROM spend s
      JOIN prepaid_card pc ON s.prepaid_card_id = pc.id
      LEFT JOIN course c ON s.course_id = c.id
      LEFT JOIN court ct ON c.court_id = ct.id
      LEFT JOIN coach co ON c.coach_id = co.coach_id
      WHERE pc.number = ?
      ORDER BY COALESCE(c.end_time, '1970-01-01 00:00:00') DESC, s.id DESC
      LIMIT ${limit} OFFSET ${offset}`
    
    console.log('执行查询 SQL:', sql)
    console.log('查询参数:', [phoneNumber])
    const [rows] = await connection.execute(sql, [phoneNumber])
    console.log('查询结果数量:', rows.length)

    // 关闭数据库连接
    await connection.end()

    return {
      success: true,
      data: rows,
      count: rows.length,
      total: total,
      page: currentPage,
      pageSize: limit,
      hasMore: offset + rows.length < total
    }

  } catch (error) {
    // 确保连接被关闭
    if (connection) {
      await connection.end().catch(() => {})
    }

    console.error('查询消费记录失败:', error)
    console.error('错误详情:', {
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
      sql: error.sql
    })
    return {
      success: false,
      message: '查询失败',
      error: error.message
    }
  }
}