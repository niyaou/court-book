const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const outTradeNo = event.outTradeNo;
  if (!outTradeNo) return { errcode: 0, errmsg: 'missing outTradeNo' };

  const db = cloud.database();
  const payRes = await db.collection('court_rush_payment').where({
    outTradeNo,
    deleted_at: db.command.eq(null),
  }).limit(1).get();
  const payment = (payRes.data || [])[0];
  if (!payment) return { errcode: 0, errmsg: 'payment not found' };

  const refundUpdateRes = await db.collection('court_rush_payment').where({
    _id: payment._id,
    status: 'REFUNDING',
    deleted_at: db.command.eq(null),
  }).update({
    data: {
      status: 'REFUNDED',
      refundTime: db.serverDate(),
      notify_time: db.serverDate(),
      updated_at: db.serverDate(),
    },
  });
  if (!refundUpdateRes.stats || refundUpdateRes.stats.updated !== 1) {
    return { errcode: 0, message: 'idempotent skip' };
  }

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

  const rush = await db.collection('court_rush').doc(payment.court_rush_id).get();
  if (rush.data && !rush.data.deleted_at && rush.data.auto_cancel_status === 'PROCESSING') {
    const updatedRush = await db.collection('court_rush').doc(payment.court_rush_id).get();
    if (updatedRush.data.current_participants === 0 && updatedRush.data.held_participants === 0) {
      await db.collection('court_rush').doc(payment.court_rush_id).update({
        data: {
          status: 'CANCELLED',
          auto_cancel_status: 'DONE',
          cancelled_at: db.serverDate(),
          deleted_at: db.serverDate(),
          updated_at: db.serverDate(),
        },
      });

      await db.collection('court_order_collection').where({
        source_type: 'COURT_RUSH',
        rush_id: payment.court_rush_id,
      }).remove();
    }
  }

  return { errcode: 0, outTradeNo };
};
