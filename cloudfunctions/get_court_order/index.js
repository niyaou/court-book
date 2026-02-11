// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

function generateTimeSlots(start, end, interval) {
  // start, end: 'HH:mm' 字符串
  // interval: 分钟数
  const slots = []
  let [sh, sm] = start.split(':').map(Number)
  let [eh, em] = end.split(':').map(Number)
  let startMinutes = sh * 60 + sm
  let endMinutes = eh * 60 + em

  for (let t = startMinutes; t < endMinutes; t += interval) {
    let h1 = Math.floor(t / 60)
    let m1 = t % 60
    let h2 = Math.floor((t + interval) / 60)
    let m2 = (t + interval) % 60
    slots.push({
      start: `${h1.toString().padStart(2, '0')}:${m1.toString().padStart(2, '0')}`,
      end: `${h2.toString().padStart(2, '0')}:${m2.toString().padStart(2, '0')}`
    })
  }
  return slots
}

function getPrice(court, slot, campus) {
  // 根据校区配置不同的价格
  const court_price_mapping = {
    "麓坊校区": {
      "1号风雨棚": 90,
      "2号风雨棚": 90,
      "3号风雨棚": 90,
      "4号风雨棚": 90,
      "5号风雨棚": 90,
      "6号风雨棚": 90,
      "7号室外": 60,
      "8号室外": 60,
      "9号室外": 60,
      "10号室外": 60,
      "11号红土风雨棚": 100,
    },
    "桐梓林校区": {
      "1号风雨棚": 60,
      "2号风雨棚": 60,
    },
    "雅居乐校区": {
      "1号风雨棚": 90,
      "2号室外": 60,
    }
  }

  // 获取对应校区的价格配置
  const campusPrices = court_price_mapping[campus] || court_price_mapping["麓坊校区"]; // 默认使用麓坊校区价格
  const basePrice = campusPrices[court] || 60; // 默认价格60元
  
  const [hour] = slot.start.split(':').map(Number);
  return hour >= 18 ? basePrice + 10 : basePrice;
}

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()

  const db = cloud.database()
  const { date, campus, courtNumber } = event
  
  // 调试：打印接收到的参数
  console.log('接收到的参数:', { date, campus, courtNumber })

  // 1. 查询场地列表
  const courtList = await db.collection('court').where({ campus }).get()
  console.log('场地列表:', courtList.data)

  // 2. 生成时间段
  // 根据校区设置不同的时间段：麓坊、雅居乐07:00-24:00，桐梓林09:00-22:00
  const campusTimeConfig = {
    '麓坊校区': { start: '07:00', end: '24:00' },
    '雅居乐校区': { start: '07:00', end: '24:00' },
    '桐梓林校区': { start: '09:00', end: '22:00' }
  };
  const { start, end } = campusTimeConfig[campus] || campusTimeConfig['麓坊校区'];
  const timeSlots = generateTimeSlots(start, end, 30);
  // console.log('生成的时间段:', timeSlots)

  // 3. 查询预订状态
  const MAX_LIMIT = 300
  const countResult = await db.collection('court_order_collection').where({
    date,
    campus,
    courtNumber // 可选，或遍历所有场地
  }).count()
  const total = countResult.total
  const batchTimes = Math.ceil(total / MAX_LIMIT)
  const tasks = []
  for (let i = 0; i < batchTimes; i++) {
    const promise = db.collection('court_order_collection').where({
      date,
      campus,
      courtNumber
    }).skip(i * MAX_LIMIT).limit(MAX_LIMIT).get()
    tasks.push(promise)
  }
  const orderRes = await Promise.all(tasks)
  const orderList = orderRes.reduce((acc, cur) => {
    return {
      data: acc.data.concat(cur.data)
    }
  }, { data: [] }).data
  console.log('查询到的订单列表数量:', orderList.length)
  console.log('查询到的订单列表数据大小:', JSON.stringify(orderList).length, 'bytes')

  // 3.1 过滤并删除过期的锁定订单
  const now = new Date()
  
  // 获取所有锁定订单的预订者手机号，用于检查管理员权限
  const lockedOrders = orderList.filter(order => order.status === 'locked')
  const phoneNumbers = [...new Set(lockedOrders.map(order => order.booked_by))]
  
  let managerPhones = new Set()
  if (phoneNumbers.length > 0) {
    const managerCheck = await db.collection('manager')
      .where({
        phoneNumber: db.command.in(phoneNumbers)
      })
      .get()
    managerPhones = new Set(managerCheck.data.map(m => m.phoneNumber))
  }
  
  const expiredLockedOrders = orderList.filter(order => {
    if (order.status === 'locked') {
      const orderTime = new Date(order.updated_at)
      const diffMinutes = (now - orderTime) / (1000 * 60)
      
      // 根据预订者类型确定锁定时间
      const isManager = managerPhones.has(order.booked_by)
      const lockTimeLimit = isManager ? 10 : 6 // 管理员10分钟，普通用户5分钟
      
      return diffMinutes > lockTimeLimit
    }
    return false
  })
  console.log('过期的锁定订单数量:', expiredLockedOrders.length)

  // 删除过期的锁定订单
  if (expiredLockedOrders.length > 0) {
    const expiredOrderIds = expiredLockedOrders.map(order => order._id)
    await db.collection('court_order_collection').where({
      _id: db.command.in(expiredOrderIds)
    }).remove()
    
    // 从orderList中移除已删除的订单
    const expiredOrderIdSet = new Set(expiredOrderIds)
    const filteredOrderList = orderList.filter(order => !expiredOrderIdSet.has(order._id))
    orderList.length = 0
    orderList.push(...filteredOrderList)
    console.log('删除过期锁定订单后的订单列表数量:', orderList.length)
  }

  // 3.2 过滤并删除过期的pending订单 - 从pay_order表查询
  // 先获取所有管理员手机号
  const managerResult = await db.collection('manager').get()
  const allManagerPhones = managerResult.data.map(m => m.phoneNumber)
  console.log('管理员手机号列表:', allManagerPhones)
  
  // 计算4分钟前的时间戳
  const fourMinutesAgo = new Date(now.getTime() - 4 * 60 * 1000)
  
  // 查询条件：status为PENDING，且满足以下条件之一：
  // 1. 创建时间超过4分钟且未开始支付（paymentQueryTime为null）
  // 2. 支付查询时间超过1分钟（给用户1分钟支付时间）
  const pendingOrdersResult = await db.collection('pay_order').where({
    status: 'PENDING',
    phoneNumber: db.command.nin(allManagerPhones), // 排除管理员手机号
    _: db.command.or([
      {
        createTime: db.command.lt(fourMinutesAgo),
        paymentQueryTime: null // 未开始支付且创建时间超过4分钟
      },
      {
        createTime: db.command.lt(fourMinutesAgo),
        paymentQueryTime: db.command.lt(new Date(now.getTime() - 1 * 60 * 1000)) // 支付查询时间超过1分钟
      }
    ])
  }).get()
  
  const expiredPendingOrders = pendingOrdersResult.data
  console.log('从pay_order表查询到的过期pending订单数量:', expiredPendingOrders.length)
  
  // 记录要删除的订单信息
  expiredPendingOrders.forEach(order => {
    const orderTime = new Date(order.created_at)
    const diffMinutes = (now - orderTime) / (1000 * 60)
    console.log('删除过期pending订单:', order.court_id, order.booked_by, '过期时间:', diffMinutes.toFixed(2), '分钟')
  })

  // 删除过期的pending订单
  if (expiredPendingOrders.length > 0) {
    const expiredPendingOrderIds = expiredPendingOrders.map(order => order._id)
    try {
      // 删除pay_order表中的过期订单
      const deletePayOrderResult = await db.collection('pay_order').where({
        _id: db.command.in(expiredPendingOrderIds)
      }).remove()
      console.log('删除pay_order表中过期pending订单结果:', deletePayOrderResult)
      


  
     
    } catch (error) {
      console.error('删除过期pending订单失败:', error)
    }
  }

  // 4. 补全空闲状态
  const result = []
  // 优化：只处理指定的场地
  const targetCourts = courtNumber ? 
    courtList.data.filter(court => court.courtNumber === courtNumber) : 
    courtList.data

  // 获取当前时间信息
  const currentDate = now.toISOString().split('T')[0] // 当前日期 YYYY-MM-DD
  const currentTime = now.toTimeString().slice(0, 5) // 当前时间 HH:mm

  for (let court of targetCourts) {
    console.log('处理场地:', court.courtNumber)
    for (let slot of timeSlots) {
      const order = orderList.find(o => o.courtNumber === court.courtNumber && o.start_time === slot.start && o.end_time === slot.end)
      if (order) {
        // 移除 _at 字段和其他不必要的字段
        const { created_at, updated_at, _id, ...orderWithoutAt } = order
        result.push(orderWithoutAt)
      } else {
        // 构建时间段的具体时间点进行比较（使用本地时区）
        const year = parseInt(date.substring(0, 4))
        const month = parseInt(date.substring(4, 6)) - 1 // 月份从0开始
        const day = parseInt(date.substring(6, 8))
        const [hour, minute] = slot.start.split(':').map(Number)
        
        // 创建本地时间（北京时间 UTC+8）
        const slotDateTime = new Date(year, month, day, hour, minute, 0)
        
        // 获取当前北京时间（UTC+8）
        const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000)
        
        // 检查是否是过去的时间段（都在北京时间下比较）
        const isPastTime = slotDateTime < beijingTime
        
        // 调试信息
        
        let status = 'free'
        let court_id = null
        let booked_by = null
        
        // // 如果是过去的时间段，按照80%的概率补充预订信息
        // if (isPastTime ) {
        //   status = 'booked'
        //   court_id = `${court.courtNumber}_${date}_${slot.start}`
        //   booked_by = '18628172619'
        // }
        
        result.push({
          courtNumber: court.courtNumber,
          campus: court.campus,
          date,
          start_time: slot.start,
          end_time: slot.end,
          status,
          price: getPrice(court.courtNumber, slot, court.campus),
          isPastTime:isPastTime,
          ...(court_id && { court_id }),
          ...(booked_by && { booked_by })
        })
      }
    }
  }

  // 5. 返回
  console.log('最终返回结果数量:', result.length)
  console.log('最终返回数据大小:', JSON.stringify(result).length, 'bytes')
  
  // 检查返回数据大小是否超过限制
  const responseSize = JSON.stringify({ success: true, data: result }).length
  if (responseSize > 900 * 1024) { // 900KB 作为安全阈值
    console.error('返回数据过大:', responseSize, 'bytes')
    return {
      success: false,
      error: '数据量过大，请缩小查询范围'
    }
  }

  return { success: true, data: result }
}