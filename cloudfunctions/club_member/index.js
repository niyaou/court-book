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
  const { phoneNumber } = event

  // 参数校验
  if (!phoneNumber) {
    return {
      success: false,
      message: '缺少 phoneNumber 参数'
    }
  }

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

    // 查询 prepaid_card 表
    const [rows] = await connection.execute(
      'SELECT * FROM prepaid_card WHERE number = ?',
      [phoneNumber]
    )

    // 关闭数据库连接
    await connection.end()

    if (rows.length === 0) {
      return {
        success: false,
        message: '未找到对应的会员信息',
        data: null
      }
    }

    return {
      success: true,
      data: rows[0]
    }

  } catch (error) {
    // 确保连接被关闭
    if (connection) {
      await connection.end().catch(() => {})
    }

    console.error('数据库查询失败:', error)
    return {
      success: false,
      message: '查询失败',
      error: error.message
    }
  }
}