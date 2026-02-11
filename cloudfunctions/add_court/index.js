// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const db = cloud.database()
  const { campus, courtNumber } = event

  try {
    // 查询是否已存在相同 campus 和 courtNumber 的场地
    const existRes = await db.collection('court').where({
      campus,
      courtNumber
    }).get()
    if (existRes.data && existRes.data.length > 0) {
      return {
        success: false,
        error: '该场地已存在'
      }
    }
    // 不存在则插入
    const res = await db.collection('court').add({
      data: {
        campus,
        courtNumber
      }
    })
    return {
      success: true,
      id: res._id
    }
  } catch (e) {
    return {
      success: false,
      error: e.message
    }
  }
}