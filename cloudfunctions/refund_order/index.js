// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境
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

// 云函数入口函数
exports.main = async (event) => {
  console.log('退款请求参数:', event);

  const db = cloud.database()
  const {   total_fee, _id ,  nonceStr } = event
  const outRefundNo = generateOrderNo(event)
  console.log('生成的退款单号:', outRefundNo);

  try {
    // 1. 查询订单信息
    const orderRes = await db.collection('pay_order').doc(_id).get()
    console.log('订单查询结果:', orderRes);
    if (!orderRes.data) {
      console.log('订单不存在，订单ID:', _id);
      return {
        success: false,
        message: '订单不存在'
      }
    }
    const order = orderRes.data
    console.log('订单详情:', order);
    
    // 2. 验证订单状态
    console.log('当前订单状态:', order.status);
    if (order.status !== 'PAIDED') {
      console.log('订单状态不正确，无法退款');
      return {
        success: false,
        message: '订单状态不正确，无法退款'
      }
    }

    // 3. 验证订单时间（24小时内可退款）
    const now = new Date()
    console.log('当前时间:', now.toLocaleString());
    let canRefund = true
    let earliestBookingTime = null

    // 检查每个场地预订时间
    for (const courtId of order.court_ids) {
      console.log('正在检查场地ID:', courtId);
      // 解析场地ID中的日期和时间
      console.log('正在检查场地ID:', courtId);
      // 解析场地ID中的日期和时间
      const [courtNumber, date, time] = courtId.split('_')
      const year = date.substring(0, 4)
      const month = date.substring(4, 6)
      const day = date.substring(6, 8)
      const [hour, minute] = time.split(':')
      
      console.log('解析的日期时间组件:', {
        courtNumber,
        year,
        month,
        day,
        hour,
        minute
      });
      
      // 创建预订时间对象
      const bookingTime = new Date(year, month - 1, day, hour, minute)
      console.log('场地预订时间:', bookingTime.toLocaleString());
      console.log('场地预订时间(ISO):', bookingTime.toISOString());
      
      // 如果预订时间在未来，检查是否超过24小时
    
        const diffHours = (bookingTime - now) / (1000 * 60 * 60)
        console.log('距离预订时间还有:', diffHours.toFixed(2), '小时');
        if (diffHours <= 24) {
          canRefund = false
          earliestBookingTime = bookingTime
          console.log('发现24小时内的预订，无法退款');
          break
        }
    }

    if (!canRefund) {
      console.log('退款被拒绝，原因：包含24小时内的预订');
      return {
        success: false,
        message: `订单包含24小时内的预订时间（${earliestBookingTime.toLocaleString()}），无法退款`
      }
    }

    // 4. 调用微信支付退款接口
    console.log('准备调用微信退款接口，参数:', {
      out_refund_no: outRefundNo,
      out_trade_no: order.outTradeNo,
      total_fee: total_fee * 100,
      refund_fee: total_fee * 100,
      nonce_str: nonceStr
    });

    const refundRes = await cloud.cloudPay.refund({
      out_refund_no:outRefundNo,
      out_trade_no:order.outTradeNo,
      total_fee:total_fee * 100,
      refund_fee:total_fee * 100,
      nonce_str:nonceStr,
      subMchId :"1716570749",
      envId: "cloud1-6gebob4m4ba8f3de",
      functionName: "order_refund_callback", // 支付结果通知回调云函数名,
    })
    console.log('微信退款接口返回结果:', refundRes);

    if (refundRes.resultCode === 'FAIL') {
      console.log('退款失败，错误信息:', refundRes.errCodeDes);
      // 更新订单状态，记录退款失败原因
      await db.collection('pay_order').doc(_id).update({
        data: {
          refundStatus: 'FAILED',
          refundFailReason: refundRes.errCodeDes,
          refundFailTime: db.serverDate()
        }
      });

      return {
        success: false,
        message: '退款申请失败：' + refundRes.errCodeDes
      }
    }
    console.log('退款申请成功');
    return {
      success: true,
      message: '退款申请成功'
    }

  } catch (error) {
    console.error('退款过程发生异常:', error);
    return {
      success: false,
      message: '退款失败：' + error.message
    }
  }
}