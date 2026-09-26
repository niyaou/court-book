// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

// 与 update_court_order 的普通用户五分钟接管期限一致。
const BOOKING_LOCK_DURATION_MS = 5 * 60 * 1000
const PAYMENT_TIMEOUT_MINUTES = 2
const PAYMENT_SAFETY_MARGIN_MS = 10 * 1000

function bookingLockFailure(error, message) {
  return { success: false, error, message }
}

async function checkBookingLocks(db, courtIds, campus, phoneNumber, previousLocks) {
  try {
    const records = []
    // 分批并分页读取，既检查所有请求时段，也不能漏掉重复占场记录。
    for (let start = 0; start < courtIds.length; start += 20) {
      const ids = courtIds.slice(start, start + 20)
      for (let offset = 0; ; offset += 100) {
        const result = await db.collection('court_order_collection').where({
          campus,
          court_id: db.command.in(ids)
        }).orderBy('_id', 'asc').skip(offset).limit(100).get()
        records.push(...result.data)
        if (result.data.length < 100) break
      }
    }

    const now = Date.now()
    const locks = new Map()
    let lockDeadline = Infinity
    for (const record of records) {
      if (locks.has(record.court_id)) {
        return bookingLockFailure('BOOKING_LOCK_DATA_ERROR', '场地数据异常，请刷新重试或联系管理员')
      }
      if (record.campus !== campus || record.status !== 'locked' ||
          record.booked_by !== phoneNumber ||
          record.source_type === 'GROUP_COURSE' || record.source_type === 'COURT_RUSH') {
        return bookingLockFailure('BOOKING_LOCK_CONFLICT', '场地状态已变化，请刷新后重新选择时段')
      }
      const rawTime = record.updated_at
      const updatedAt = rawTime instanceof Date || typeof rawTime === 'string' || typeof rawTime === 'number'
        ? new Date(rawTime).getTime() : NaN
      if (!record._id || !Number.isFinite(updatedAt) || updatedAt > now) {
        return bookingLockFailure('BOOKING_LOCK_DATA_ERROR', '场地数据异常，请刷新重试或联系管理员')
      }
      const previous = previousLocks && previousLocks.get(record.court_id)
      if (previousLocks && (!previous || previous.id !== record._id ||
          previous.version !== record.version || previous.updatedAt !== updatedAt)) {
        return bookingLockFailure('BOOKING_LOCK_CONFLICT', '场地状态已变化，请刷新后重新选择时段')
      }
      locks.set(record.court_id, { id: record._id, version: record.version, updatedAt })
      lockDeadline = Math.min(lockDeadline, updatedAt + BOOKING_LOCK_DURATION_MS)
    }
    if (courtIds.some(id => !locks.has(id))) {
      return bookingLockFailure('BOOKING_LOCK_MISSING', '预订已失效，请刷新后重新选择时段')
    }
    const paymentExpireTime = new Date(now + PAYMENT_TIMEOUT_MINUTES * 60 * 1000)
    if (paymentExpireTime.getTime() + PAYMENT_SAFETY_MARGIN_MS >= lockDeadline) {
      return bookingLockFailure('BOOKING_LOCK_EXPIRED', '预订已过期或剩余付款时间不足，请刷新后重新选择时段')
    }
    return { success: true, locks, paymentExpireTime }
  } catch (error) {
    console.error('[pay_order_create] 锁场校验失败', error)
    return bookingLockFailure('BOOKING_LOCK_CHECK_FAILED', '暂时无法确认场地状态，请稍后重试')
  }
}

function formatTimeExpire(date) {
  // 确保使用北京时间（UTC+8）
  // 将UTC时间转换为北京时间：UTC+8
  const beijingOffset = 8 * 60 * 60 * 1000 // UTC+8 的毫秒偏移（8小时）
  const beijingTime = new Date(date.getTime() + beijingOffset)
  
  const pad = (num) => num.toString().padStart(2, '0')
  const year = beijingTime.getUTCFullYear()
  const month = pad(beijingTime.getUTCMonth() + 1)
  const day = pad(beijingTime.getUTCDate())
  const hour = pad(beijingTime.getUTCHours())
  const minute = pad(beijingTime.getUTCMinutes())
  const second = pad(beijingTime.getUTCSeconds())
  return `${year}${month}${day}${hour}${minute}${second}`
}

// 生成32位订单号
function generateOrderNo(params) {
  const { phoneNumber, openid, total_fee, campus, courtNumber, date, timeSeries } = params;
  // 组合参数并添加时间戳
  const baseStr = `${phoneNumber}${openid}${total_fee}${campus}${courtNumber}${date}${timeSeries}${Date.now()}`;
  // 使用crypto模块生成hash
  const crypto = require('crypto');
  const hash = crypto.createHash('md5').update(baseStr).digest('hex');
  // 取前32位
  return hash.substring(0, 32);
}

// 检查重复订单
async function checkDuplicateOrders(db, court_ids, campus) {
  // 计算7天前的时间
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  console.log('检查重复订单 - 7天前时间:', sevenDaysAgo);
  console.log('检查的court_ids:', court_ids);
  console.log('检查的campus:', campus);
  console.log('court_ids类型:', Array.isArray(court_ids) ? '数组' : typeof court_ids);
  
  // 查询7天内状态为PENDING或PAIDED的订单，检查是否有court_ids重叠
  // court_ids是一个字符串数组，每个元素格式为: "场地号_日期_时间"
  // 使用 db.command.in(court_ids) 查找订单的court_ids数组中包含我们要预订的任何一个court_id的订单
  // 同时检查校区是否相同，只有相同校区的订单才会被认为是重复订单
  const existingOrders = await db.collection('pay_order').where({
    status: db.command.in(['PENDING', 'PAIDED']),
    createTime: db.command.gte(sevenDaysAgo),
    campus: campus, // 添加校区条件，确保只有相同校区的订单才会被检查
    court_ids: db.command.in(court_ids) // 查找court_ids数组中包含我们要预订的任何一个court_id的订单
  }).get();
  
  console.log('查询到的相关订单数量:', existingOrders.data.length);
  
  // 验证查询结果：检查每个返回的订单是否真的包含重叠的court_ids
  for (const order of existingOrders.data) {
    console.log('检查订单:', order.outTradeNo);
    console.log('订单court_ids:', order.court_ids);
    console.log('订单campus:', order.campus);
    console.log('我们要预订的court_ids:', court_ids);
    console.log('我们要预订的campus:', campus);
    
    // 检查是否有重叠
    const overlap = court_ids.filter(id => order.court_ids.includes(id));
    console.log('重叠的court_ids:', overlap);
    
    if (overlap.length > 0) {
      console.log('发现重复订单冲突:', order.outTradeNo);
      console.log('冲突订单的court_ids:', order.court_ids);
      console.log('冲突订单的campus:', order.campus);
      console.log('冲突订单状态:', order.status);
      console.log('冲突订单创建时间:', order.createTime);
      
      return {
        isDuplicate: true,
        message: '所选场地在7天内已被预订，请选择其他场地',
        conflictingOrder: order
      };
    }
  }
  
  console.log('未发现重复订单');
  return {
    isDuplicate: false
  };
}

async function getVipInfo(phoneNumber) {
  try {
    // 复用现有会员查询云函数，实际由该云函数访问外部数据库
    const res = await cloud.callFunction({
      name: 'club_member',
      data: { phoneNumber }
    })
    const result = res && res.result
    if (!result || !result.success || !result.data) {
      return { isVip: false, balance: 0 }
    }
    const member = result.data
    const balance = Number(member.rest_charge || 0) + Number(member.annual_count || 0) * 150 + Number(member.times_count || 0) * 150
    return { isVip: balance > 0, balance }
  } catch (error) {
    console.error('查询会员信息失败:', error)
    return { isVip: false, balance: 0 }
  }
}

function getBasePrice(court, campus, startTime, isVip) {
  // 麓坊所有场地统一按半小时计价；VIP 身份沿用服务端查询结果。
  if (campus === '麓坊校区') {
    const [hour, minute] = startTime.split(':').map(Number)
    const minutes = hour * 60 + minute
    const isPeak = (minutes >= 9 * 60 && minutes < 12 * 60) ||
      (minutes >= 16 * 60 && minutes < 21 * 60)
    return isPeak ? (isVip ? 75 : 90) : (isVip ? 50 : 60)
  }

  const courtPriceMapping = {
    "麓坊校区": {
      "1号风雨棚": 90,
      "2号风雨棚": 90,
      "3号风雨棚": 90,
      "4号风雨棚": 90,
      "5号风雨棚": 90,
      "6号风雨棚": 90,
      "7号风雨棚": 90,
      "8号风雨棚": 90,
      "9号风雨棚": 90,
      "10号风雨棚": 90,
      "7号室外": 60,
      "8号室外": 60,
      "9号室外": 60,
      "10号室外": 60,
      "11号红土风雨棚": 100
    },
    "桐梓林校区": {
      "1号风雨棚": 60,
      "2号风雨棚": 60
    },
    "雅居乐校区": {
      "1号风雨棚": 90,
      "2号室外": 60
    }
  }

  const campusPrices = courtPriceMapping[campus] || courtPriceMapping["麓坊校区"]
  return campusPrices[court] || 60
}

function parseCourtId(courtId) {
  const parts = String(courtId || '').split('_')
  if (parts.length < 3) {
    throw new Error(`INVALID_COURT_ID:${courtId}`)
  }
  return {
    court_id: courtId,
    court: parts.slice(0, parts.length - 2).join('_'),
    date: parts[parts.length - 2],
    start_time: parts[parts.length - 1],
  }
}

async function resolveLightingPricing(campus, courtInfos) {
  const response = await cloud.callFunction({
    name: 'booking_pricing',
    data: {
      campus,
      slots: courtInfos.map((item) => ({ date: item.date, start_time: item.start_time })),
    },
  })
  const result = response && response.result
  if (!result || !result.success || !result.data) {
    const error = new Error((result && result.message) || '灯光费配置读取失败')
    error.code = (result && result.error) || 'PRICING_CONFIG_ERROR'
    throw error
  }
  return result.data
}

function calculateTotalFee(courtInfos, campus, isVip, pricedSlots) {
  let total = 0
  for (let index = 0; index < courtInfos.length; index += 1) {
    const info = courtInfos[index]
    const finalBasePrice = getBasePrice(info.court, campus, info.start_time, isVip)
    total += finalBasePrice + Number(pricedSlots[index].lighting_fee_yuan || 0)
  }
  return Math.round(total * 100) / 100
}

// 云函数入口函数
exports.main = async (event, ) => {
  const { phoneNumber,  openid,  court_ids  ,nonceStr,campus } = event
  const db = cloud.database()

  if (!Array.isArray(court_ids) || court_ids.length === 0 ||
      court_ids.some(id => typeof id !== 'string' || !id.trim()) ||
      new Set(court_ids).size !== court_ids.length) {
    return {
      success: false,
      message: '所选场地无效',
      error: 'INVALID_COURT_IDS'
    }
  }
  if (typeof phoneNumber !== 'string' || !phoneNumber.trim() ||
      typeof campus !== 'string' || !campus.trim()) {
    return bookingLockFailure('INVALID_BOOKING_INPUT', '预订资料不完整，请刷新后重新选择时段')
  }
  
  // 管理员预订时 pay_order 已在 update_court_order 中创建，此处不应重复调用
  const managerCheck = await db.collection('manager').where({ phoneNumber }).get()
  const isManager = managerCheck.data && managerCheck.data.length > 0
  if (isManager) {
    return {
      success: false,
      message: '管理员预订已完成，无需再次确认',
      error: 'ADMIN_ORDER_ALREADY_CREATED'
    }
  }

  let courtInfos
  try {
    courtInfos = court_ids.map(parseCourtId)
  } catch (error) {
    return {
      success: false,
      message: '订单数据异常，请重新选择时段',
      error: 'INVALID_COURT_ID'
    }
  }

  // 检查重复订单
  const duplicateCheck = await checkDuplicateOrders(db, court_ids, campus);
  if (duplicateCheck.isDuplicate) {
    return {
      success: false,
      message: duplicateCheck.message,
      error: 'DUPLICATE_ORDER'
    };
  }

  const initialLockCheck = await checkBookingLocks(db, court_ids, campus, phoneNumber)
  if (!initialLockCheck.success) return initialLockCheck

  // 服务端查询会员并重新计算订单金额，不信任前端传入 total_fee
  const vipInfo = await getVipInfo(phoneNumber)
  let total_fee = 0
  let lightingPricing
  try {
    lightingPricing = await resolveLightingPricing(campus, courtInfos)
    total_fee = calculateTotalFee(courtInfos, campus, vipInfo.isVip, lightingPricing.slots)
  } catch (error) {
    console.error('[pay_order_create] 计费失败', error)
    const isPricingError = error.code && error.code.includes('PRICING_')
    return {
      success: false,
      message: isPricingError ? '灯光费配置异常，请联系管理员' : '订单数据异常，请重新选择时段',
      error: isPricingError ? error.code : 'INVALID_COURT_ID'
    }
  }
  const lighting_fee_yuan = lightingPricing.total_lighting_fee_yuan
  const pricing_rule_ids = [...new Set(lightingPricing.rules.map((rule) => rule.rule_id))]
  const outTradeNo = generateOrderNo({ ...event, total_fee })

  // 会员和价格查询可能耗时，微信下单前重新确认锁仍属于本次预订。
  // 此检查不续锁；两次读取也不替代数据库事务。
  const finalLockCheck = await checkBookingLocks(db, court_ids, campus, phoneNumber, initialLockCheck.locks)
  if (!finalLockCheck.success) return finalLockCheck
  const paymentTimeoutMinutes = PAYMENT_TIMEOUT_MINUTES
  const paymentExpireTime = finalLockCheck.paymentExpireTime
  const timeExpire = formatTimeExpire(paymentExpireTime)

  const res = await cloud.cloudPay.unifiedOrder({
    outTradeNo,
    body: `订场-在线支付`,
    totalFee: Math.round(total_fee * 100),
    subMchId :"1716570749",
    nonceStr,
    openid,
    spbillCreateIp: '127.0.0.1',
    envId:"cloud1-6gebob4m4ba8f3de",
    tradeType: "JSAPI",
    timeExpire,
    functionName: "order_create_callback", // 支付结果通知回调云函数名,
  })
  console.log( {
    phoneNumber,
    total_fee,
    court_ids,
    outTradeNo,
    payment_parmas:res.payment,
    createTime: db.serverDate(),
    timeExpire,
    paymentQueryTime: null,
    campus:campus,
    status: 'PENDING' // 初始状态为待支付
  })
  // 创建订单记录
  console.log(res.payment)
  await db.collection('pay_order').add({
    data: {
      phoneNumber,
      total_fee,
      lighting_fee_yuan,
      pricing_rule_ids,
      lighting_pricing_snapshot: lightingPricing.rules,
      court_ids,
      campus:campus,
      is_vip: vipInfo.isVip,
      vip_balance: vipInfo.balance,
      outTradeNo,
      payment_parmas:res.payment,
      paymentTimeoutMinutes,
      paymentExpireTime,
      createTime: db.serverDate(),
      timeExpire,
      paymentQueryTime: null, // 支付查询时间，初始为null
      status: 'PENDING' // 初始状态为待支付
    }
  })

  return res
}
