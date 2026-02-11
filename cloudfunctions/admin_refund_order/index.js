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

// 验证管理员身份
async function validateAdmin(phoneNumber, adminPassword) {
  const db = cloud.database();
  
  try {
    // 查询manager表，同时满足phoneNumber和password都一样的数据
    const managerRes = await db.collection('manager').where({
      phoneNumber: phoneNumber,
      password: adminPassword
    }).get();
    
    // 如果查到了数据，说明验证通过
    if (managerRes.data && managerRes.data.length > 0) {
      return {
        isValid: true,
        manager: managerRes.data[0]
      };
    }
    
    // 如果没数据，说明验证不通过
    return {
      isValid: false,
      message: '管理员验证失败：手机号或密码错误'
    };
    
  } catch (error) {
    console.error('查询manager表失败:', error);
    return {
      isValid: false,
      message: '管理员验证失败：' + error.message
    };
  }
}

// 云函数入口函数
exports.main = async (event) => {
  console.log('管理员退款请求参数:', event);

  const db = cloud.database()
  const { total_fee, _id, nonceStr, phoneNumber, adminPassword } = event
  
  // 验证必要参数
  if (!phoneNumber) {
    return {
      success: false,
      message: '请输入管理员手机号'
    }
  }
  
  if (!adminPassword) {
    return {
      success: false,
      message: '请输入管理员密码'
    }
  }

  // 验证管理员身份
  const adminValidation = await validateAdmin(phoneNumber, adminPassword);
  if (!adminValidation.isValid) {
    return {
      success: false,
      message: adminValidation.message
    }
  }

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



    // 4. 调用微信支付退款接口
    console.log('准备调用微信退款接口，参数:', {
      out_refund_no: outRefundNo,
      out_trade_no: order.outTradeNo,
      total_fee: total_fee * 100,
      refund_fee: total_fee * 100,
      nonce_str: nonceStr
    });

    const refundRes = await cloud.cloudPay.refund({
      out_refund_no: outRefundNo,
      out_trade_no: order.outTradeNo,
      total_fee: total_fee * 100,
      refund_fee: total_fee * 100,
      nonce_str: nonceStr,
      subMchId: "1716570749",
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
          refundFailTime: db.serverDate(),
          adminRefundAttempt: true,
          adminRefundTime: db.serverDate(),
          adminPhoneNumber: phoneNumber // 记录执行退款的管理员手机号
        }
      });

      return {
        success: false,
        message: '退款申请失败：' + refundRes.errCodeDes
      }
    }

    // 5. 记录管理员退款操作
    await db.collection('pay_order').doc(_id).update({
      data: {
        adminRefunded: true,
        adminRefundTime: db.serverDate(),
        outRefundNo: outRefundNo,
        refundStatus: 'PROCESSING',
        adminPhoneNumber: phoneNumber // 记录执行退款的管理员手机号
      }
    });
    console.log('管理员退款申请成功');
    return {
      success: true,
      message: '管理员退款申请成功'
    }
  } catch (error) {
    console.error('管理员退款过程发生异常:', error);
    return {
      success: false,
      message: '退款失败：' + error.message
    }
  }

} 