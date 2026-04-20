const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  if (value.$date) return new Date(value.$date);
  return null;
}

exports.main = async (event) => {
  const { paymentId, outTradeNo } = event || {};
  if (!paymentId && !outTradeNo) {
    return { success: false, error: 'INVALID_PARAMS', message: 'Missing paymentId or outTradeNo' };
  }

  const db = cloud.database();
  let payment = null;
  let docId = paymentId;

  if (paymentId) {
    const res = await db.collection('court_rush_payment').doc(paymentId).get();
    payment = res.data;
    if (payment && payment.deleted_at) payment = null;
  } else {
    const res = await db.collection('court_rush_payment').where({
      outTradeNo,
      deleted_at: db.command.eq(null),
    }).limit(1).get();
    payment = (res.data || [])[0];
    docId = payment && payment._id;
  }

  if (!payment || payment.deleted_at) {
    return { success: false, error: 'NOT_FOUND', message: 'Payment not found' };
  }

  if (payment.status !== 'PENDING') {
    return { success: false, error: 'INVALID_STATUS', message: 'Order status is not pending', status: payment.status };
  }

  const now = new Date();
  const paymentExpireTime = toDate(payment.paymentExpireTime);
  const expiredByWx = paymentExpireTime ? now > paymentExpireTime : false;

  if (expiredByWx) {
    return { success: false, error: 'ORDER_EXPIRED', message: 'Order expired' };
  }

  return {
    success: true,
    order: {
      _id: payment._id,
      outTradeNo: payment.outTradeNo,
      court_rush_id: payment.court_rush_id,
      enrollment_id: payment.enrollment_id,
      total_fee_yuan: payment.total_fee_yuan,
      payment_params: payment.payment_params || payment.payment_parmas,
      status: payment.status,
    },
  };
};
