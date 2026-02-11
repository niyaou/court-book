// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const db = cloud.database()
  const { campus } = event

  try {
    // 查询 court 表中指定校区的所有场地
    const res = await db.collection('court').where({ campus }).get()
    
    // 对结果按照 courtNumber 字段的数字部分进行升序排序
    const sortedData = res.data.sort((a, b) => {
      // 提取 courtNumber 中的数字部分
      const getNumber = (courtNumber) => {
        const match = courtNumber.match(/(\d+)/)
        return match ? parseInt(match[1]) : 0
      }
      
      const numA = getNumber(a.courtNumber || '')
      const numB = getNumber(b.courtNumber || '')
      
      return numA - numB
    })
    
    return {
      success: true,
      data: sortedData
    }
  } catch (e) {
    return {
      success: false,
      error: e.message
    }
  }
}