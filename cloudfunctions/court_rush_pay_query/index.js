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
  } else {
    const res = await db.collection('court_rush_payment').where({ outTradeNo }).limit(1).get();
    payment = (res.data || [])[0];
    docId = payment && payment._id;
  }

  if (!payment) {
    return { success: false, error: 'NOT_FOUND', message: 'Payment not found' };
  }

  if (payment.status !== 'PENDING') {
    return { success: false, error: 'INVALID_STATUS', message: 'Order status is not pending', status: payment.status };
  }

  const now = new Date();
  const createTime = toDate(payment.createTime) || toDate(payment.created_at) || now;
  const paymentExpireTime = toDate(payment.paymentExpireTime);
  const paymentQueryTime = toDate(payment.paymentQueryTime);

  const createDiffMinutes = (now - createTime) / (1000 * 60);
  const queryDiffMinutes = paymentQueryTime ? (now - paymentQueryTime) / (1000 * 60) : 0;

  const expiredByWx = paymentExpireTime ? now > paymentExpireTime : false;
  const expiredByCleanupWindow = createDiffMinutes > 5 && !paymentQueryTime;
  const expiredByQueryWindow = paymentQueryTime && queryDiffMinutes > 1;

  if (expiredByWx || expiredByCleanupWindow || expiredByQueryWindow) {
    await db.collection('court_rush_payment').doc(docId).update({
      data: { status: 'CANCEL', updated_at: db.serverDate() },
    });
    return { success: false, error: 'ORDER_EXPIRED', message: 'Order expired' };
  }

  if (!payment.paymentQueryTime) {
    await db.collection('court_rush_payment').doc(docId).update({
      data: { paymentQueryTime: db.serverDate(), updated_at: db.serverDate() },
    });
  }

  return {
    success: true,
    order: {
      _id: payment._id,
      outTradeNo: payment.outTradeNo,
      court_rush_id: payment.court_rush_id,
      enrollment_id: payment.enrollment_id,
      total_fee_yuan: payment.total_fee_yuan,
      payment_parmas: payment.payment_parmas || payment.payment_params,
      payment_params: payment.payment_params || payment.payment_parmas,
      status: payment.status,
    },
  };
};
