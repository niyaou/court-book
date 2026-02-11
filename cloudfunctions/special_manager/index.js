// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const db = cloud.database()
  
  try {
    // 查询specialManager=1的数据
    const { data } = await db.collection('manager').where({
      specialManager: 1
    }).get()
    
    // 提取所有记录的phoneNumber字段组成数组
    const phoneNumbers = data.map(item => item.phoneNumber)
    
    return    phoneNumbers
  
  } catch (error) {
    return {
      success: false,
      error: error
    }
  }
}