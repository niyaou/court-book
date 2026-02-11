// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

// 云函数入口函数
exports.main = async (event) => {
  console.log(event)

  const outTradeNo = event.outTradeNo;
  if (!outTradeNo) {
    return { errcode: 0, errmsg: '缺少 outTradeNo' };
  }

  const db = cloud.database();
  console.log('outTradeNo:', outTradeNo);

  // 查询 pay_order 表
  const orderRes = await db.collection('pay_order').where({ outTradeNo }).get();
  console.log('pay_order 查询结果:', orderRes.data);
  if (!orderRes.data || orderRes.data.length === 0) {
    return { errcode: 0, errmsg: '未找到订单' };
  }
  const order = orderRes.data[0];
  // 更新 pay_order 的 status 字段为 'PAIDED'
  const updateOrderRes = await db.collection('pay_order').where({ outTradeNo }).update({ data: { status: 'REFUNDED' ,refundStatus:'SUCCESS'} });
  console.log('pay_order 状态更新结果:', updateOrderRes);
  const court_ids = order.court_ids;
  console.log('court_ids:', court_ids);
  // 批量更新 court_order_collection，把 court_id 在 court_ids 里的 删除
  if (court_ids && court_ids.length > 0) {
    const updateCourtRes = await db.collection('court_order_collection')
      .where({ court_id: db.command.in(court_ids) })
      .remove();
    console.log('court_order_collection 更新结果:', updateCourtRes);
  }
  return  { "errcode": 0  };
}