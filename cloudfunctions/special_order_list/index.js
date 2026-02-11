// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

// 云函数入口函数
exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const db = cloud.database()
  const { phoneNumber, pageNum = 1, pageSize = 20 } = event

  // 检查是否提供了电话号码
  if (!phoneNumber) {
    return {
      success: false,
      message: '请提供电话号码',
      data: []
    }
  }

  try {
    // 首先查询manager表，检查是否有specialManager字段且为1
    const managerResult = await db.collection('manager').where({
      phoneNumber: phoneNumber
    }).get()

    // 检查是否是特殊管理员
    if (!managerResult.data || managerResult.data.length === 0) {
      return {
        success: false,
        message: '该电话号码不是管理员',
        data: []
      }
    }

    const manager = managerResult.data[0]
    if (!manager.specialManager || manager.specialManager !== 1) {
      return {
        success: false,
        message: '该管理员不是特殊管理员',
        data: []
      }
    }

    // 计算7天前的时间
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    // 计算分页参数
    const skip = (pageNum - 1) * pageSize

    // 查询最近7天以内创建的所有已经paid的订单
    const result = await db.collection('pay_order')
      .where({
        status: 'PAIDED',
        createTime: db.command.gte(sevenDaysAgo)
      })
      .orderBy('createTime', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get()

    return {
      success: true,
      message: '查询成功',
      data: result.data,
      total: result.data.length,
      pageNum: pageNum,
      pageSize: pageSize
    }

  } catch (error) {
    console.error('查询失败:', error)
    return {
      success: false,
      message: '查询失败: ' + error.message,
      data: []
    }
  }
}