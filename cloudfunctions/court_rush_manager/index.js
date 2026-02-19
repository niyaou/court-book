// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const db = cloud.database()
  const _ = db.command
  
  try {
    const { data } = await db.collection('manager').where(
      _.or([
        { courtRushManager: 1 },
        { specialManager: 1 }
      ])
    ).get()
    
    const phoneNumbers = data.map(item => item.phoneNumber)
    
    return phoneNumbers
  
  } catch (error) {
    return {
      success: false,
      error: error
    }
  }
}
