// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

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

// 云函数入口函数
exports.main = async (event, ) => {
  const { phoneNumber,  total_fee,  openid,  court_ids  ,nonceStr,campus } = event
  const db = cloud.database()
  
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

  const outTradeNo = generateOrderNo(event)
  
  // 检查重复订单
  const duplicateCheck = await checkDuplicateOrders(db, court_ids, campus);
  if (duplicateCheck.isDuplicate) {
    return {
      success: false,
      message: duplicateCheck.message,
      error: 'DUPLICATE_ORDER'
    };
  }

  // 根据支付方式设置超时时间：刷卡至少1分钟，其他5分钟
  const tradeType = "JSAPI" // 当前使用小程序支付
  // 确保满足微信支付最小时间要求：刷卡至少1分钟，其他至少5分钟
  const minTimeoutMinutes = tradeType === "MICROPAY" ? 1 : 5.1
  const paymentTimeoutMinutes = tradeType === "MICROPAY" ? 1 : 5.2
  // 确保至少满足最小时间要求，向上取整到秒
  const timeoutSeconds = Math.max(minTimeoutMinutes * 60, Math.ceil(paymentTimeoutMinutes * 60))
  
  const now = Date.now()
  const paymentExpireTime = new Date(now + timeoutSeconds * 1000)
  const timeExpire = formatTimeExpire(paymentExpireTime)

  const res = await cloud.cloudPay.unifiedOrder({
    outTradeNo,
    body: `订场-在线支付`,
    totalFee: total_fee*100,
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
      court_ids,
      campus:campus,
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