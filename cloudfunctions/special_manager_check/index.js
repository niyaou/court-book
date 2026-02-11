// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const db = cloud.database()
  const { phoneNumber } = event

  try {
    // 检查是否提供了phonenumber参数
    if (!phoneNumber) {
      return {
        success: false,
        error: 'phonenumber参数不能为空'
      }
    }

    // 查询manager表中是否存在该电话号码的记录
    const { data } = await db.collection('manager')
      .where({
        phoneNumber: phoneNumber
      })
      .get()

    // 如果存在数据，检查specialManager字段
    if (data && data.length > 0) {
      const manager = data[0]
      // 检查specialManager字段是否存在且为1
      if (manager && manager.hasOwnProperty('specialManager') && manager.specialManager === 1) {
        return {
          success: true,
          result: 1
        }
      }
    }

    // 如果不存在数据或specialManager不为1，返回0
    return {
      success: true,
      result: 0
    }

  } catch (error) {
    return {
      success: false,
      error: error.message
    }
  }
}