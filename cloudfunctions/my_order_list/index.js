// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

// 云函数入口函数
exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const db = cloud.database()
  const { phoneNumber, pageNum , pageSize  } = event

  // 构建查询条件
  const query = {}
  if (phoneNumber) {
    query.phoneNumber = phoneNumber
  }

  // 检查是否是管理员
  const managerCheck = await db.collection('manager').where({
    phoneNumber: phoneNumber
  }).get()

  const isManager = managerCheck.data && managerCheck.data.length > 0

  if (isManager) {
    // 如果是管理员，查询前后7天的数据
    const sevenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
    const sevenDaysLater = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    query._ = db.command.or([
      {
        status: 'PAIDED',
        createTime: db.command.and([
          db.command.gte(sevenDaysAgo),
          db.command.lte(sevenDaysLater)
        ])
      },
      {
        status: 'PENDING',
        createTime: db.command.and([
          db.command.gte(sevenDaysAgo),
          db.command.lte(sevenDaysLater)
        ])
      }
    ])
  } else {
    // 如果不是管理员，使用原有的查询逻辑
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
    query._ = db.command.or([
      {
        status: 'PAIDED'
      },
      {
        status: 'PENDING',
        createTime: db.command.gte(tenMinutesAgo)
      }
    ])
  }

  // 计算分页参数
  const skip = (pageNum - 1) * pageSize*5

  // 查询 pay_order 集合
  const result = await db.collection('pay_order')
    .where(query)
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(pageSize*5)
    .get()

  // 如果是管理员，在应用层过滤数据
  if (isManager) {
    // 管理员可以看到所有订单，包括已过期的，用于历史记录查看
    const filteredData = result.data.filter(order => {
      if (!order.court_ids || order.court_ids.length === 0) {
        return false
      }

      // 遍历 court_ids 数组，找到最晚的时间
      let latestTime = null
      
      for (const courtId of order.court_ids) {
        // 解析场地ID中的日期和时间
        const parts = courtId.split('_')
        if (parts.length >= 3) {
          const date = parts[1] // 例如 "20250803"
          const time = parts[2] // 例如 "20:00"
          
          const year = parseInt(date.substring(0, 4))
          const month = parseInt(date.substring(4, 6)) - 1 // 月份从0开始
          const day = parseInt(date.substring(6, 8))
          const [hour, minute] = time.split(':').map(Number)
          
          // 创建预订时间对象（假设场地时间是北京时间 UTC+8）
          // 转换为UTC时间进行比较
          const localTime = new Date(year, month, day, hour, minute)
          const utcTime = new Date(localTime.getTime() - 8 * 60 * 60 * 1000) // 减去8小时转换为UTC
          
          // 找到最晚的时间
          if (!latestTime || utcTime > latestTime) {
            latestTime = utcTime
          }
        }
      }
      
      // 过滤掉最晚时间早于当前时间的订单
      if (latestTime) {
        const now = new Date()
        // 如果最晚时间早于当前时间，则过滤掉这个订单
        if (latestTime < now) {
          return false
        }
        
        // 添加订单信息，便于前端显示状态
        order.latestBookingTime = latestTime
        order.isExpired = false
      }
      
      return true
    })

    return {
      data: filteredData
    }
  }

  return {
    data: result.data
  }
}