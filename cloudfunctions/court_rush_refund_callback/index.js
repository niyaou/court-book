const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const outTradeNo = event.outTradeNo;
  if (!outTradeNo) return { errcode: 0, errmsg: 'missing outTradeNo' };

  const db = cloud.database();
  const payRes = await db.collection('court_rush_payment').where({ outTradeNo }).limit(1).get();
  const payment = (payRes.data || [])[0];
  if (!payment) return { errcode: 0, errmsg: 'payment not found' };

  if (payment.status !== 'REFUNDING') {
    return { errcode: 0, message: 'idempotent skip' };
  }

  await db.collection('court_rush_payment').doc(payment._id).update({
    data: {
      status: 'REFUNDED',
      refundTime: db.serverDate(),
      notify_time: db.serverDate(),
      updated_at: db.serverDate(),
    },
  });

  await db.collection('court_rush_enrollment').doc(payment.enrollment_id).update({
    data: {
      status: 'CANCELLED',
      updated_at: db.serverDate(),
    },
  });

  await db.collection('court_rush').where({
    _id: payment.court_rush_id,
    current_participants: db.command.gt(0),
  }).update({
    data: {
      current_participants: db.command.inc(-1),
      total_revenue_yuan: db.command.inc(-Number(payment.total_fee_yuan || 0)),
      updated_at: db.serverDate(),
    },
  });

  return { errcode: 0, outTradeNo };
};
