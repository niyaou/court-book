// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

// 云函数入口函数
exports.main = async (event, context) => {
  const db = cloud.database()
  const _ = db.command
  
  try {
    // 查询公告集合，按日期倒序排列，限制3条
    const result = await db.collection('announcement')
      .orderBy('date', 'desc')
      .limit(3)
      .get()
    
    return {
      success: true,
      data: result.data
    }
  } catch (err) {
    return {
      success: false,
      error: err
    }
  }
}