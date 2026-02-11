// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

// 云函数入口函数
exports.main = async (event) => {
  const { orderId } = event;
  
  if (!orderId) {
    return {
      success: false,
      message: '缺少订单ID'
    };
  }

  const db = cloud.database();
  
  try {
    // 查询订单是否存在且状态为PENDING
    const orderResult = await db.collection('pay_order').doc(orderId).get();
    
    if (!orderResult.data) {
      return {
        success: false,
        message: '订单不存在'
      };
    }
    
    const order = orderResult.data;
    
    // 检查订单状态
    if (order.status !== 'PENDING') {
      return {
        success: false,
        message: '订单状态不正确',
        status: order.status
      };
    }
    
    // 检查订单是否已过期（创建时间超过4分钟且未开始支付）
    const now = new Date();
    const createTime = new Date(order.createTime);
    const diffMinutes = (now - createTime) / (1000 * 60);
    
    if (diffMinutes > 4 && !order.paymentQueryTime) {
      return {
        success: false,
        message: '订单已过期'
      };
    }
    
    // 只有在第一次查询时才更新paymentQueryTime
    if (!order.paymentQueryTime) {
      await db.collection('pay_order').doc(orderId).update({
        data: {
          paymentQueryTime: db.serverDate()
        }
      });
    }
    
    return {
      success: true,
      message: '订单验证成功',
      order: {
        _id: order._id,
        outTradeNo: order.outTradeNo,
        campus: order.campus,
        payment_parmas: order.payment_parmas,
        total_fee: order.total_fee,
        court_ids: order.court_ids
      }
    };
    
  } catch (error) {
    console.error('支付查询失败:', error);
    return {
      success: false,
      message: '查询失败',
      error: error.message
    };
  }
} 