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
  if (!payment) return { errcode: 0, errmsg: 'order not found' };

  const payUpdateRes = await db.collection('court_rush_payment').where({
    _id: payment._id,
    status: 'PENDING',
    deleted_at: db.command.eq(null),
  }).update({
    data: {
      status: 'PAIDED',
      paided_at: db.serverDate(),
      notify_time: db.serverDate(),
      updated_at: db.serverDate(),
    },
  });
  if (!payUpdateRes.stats || payUpdateRes.stats.updated !== 1) {
    return { errcode: 0, message: 'idempotent skip' };
  }

  await db.collection('court_rush_enrollment').doc(payment.enrollment_id).update({
    data: {
      status: 'PAID',
      updated_at: db.serverDate(),
    },
  });

  await db.collection('court_rush').where({
    _id: payment.court_rush_id,
    held_participants: db.command.gt(0),
  }).update({
    data: {
      held_participants: db.command.inc(-1),
      current_participants: db.command.inc(1),
      total_revenue_yuan: db.command.inc(Number(payment.total_fee_yuan || 0)),
      updated_at: db.serverDate(),
    },
  });

  const rush = await db.collection('court_rush').doc(payment.court_rush_id).get();
  if (rush.data && !rush.data.deleted_at && rush.data.auto_cancel_status === 'PROCESSING') {
    try {
      await db.collection('court_rush_payment').doc(payment._id).update({
        data: { status: 'REFUNDING', updated_at: db.serverDate() },
      });
      await db.collection('court_rush_enrollment').doc(payment.enrollment_id).update({
        data: { status: 'CANCEL_REQUESTED', updated_at: db.serverDate() },
      });

      function generateNonce() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 32; i += 1) result += chars.charAt(Math.floor(Math.random() * chars.length));
        return result;
      }

      await cloud.cloudPay.refund({
        out_refund_no: `${payment.outTradeNo}_R`,
        out_trade_no: payment.outTradeNo,
        total_fee: Math.round(Number(payment.total_fee_yuan || 0) * 100),
        refund_fee: Math.round(Number(payment.total_fee_yuan || 0) * 100),
        nonce_str: generateNonce(),
        subMchId: '1716570749',
        envId: 'cloud1-6gebob4m4ba8f3de',
        functionName: 'court_rush_refund_callback',
      });
    } catch (err) {
      console.error('自动退款失败', err);
    }
  }

  return { errcode: 0, outTradeNo };
};
