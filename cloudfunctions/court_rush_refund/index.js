const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function generateNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i += 1) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

exports.main = async (event) => {
  const db = cloud.database();
  const { enrollment_id, court_rush_id, phoneNumber, nonceStr } = event || {};

  let enrollment;
  if (enrollment_id) {
    const res = await db.collection('court_rush_enrollment').doc(enrollment_id).get();
    enrollment = res.data;
  } else if (court_rush_id && phoneNumber) {
    const res = await db.collection('court_rush_enrollment').where({ court_rush_id, phoneNumber }).limit(1).get();
    enrollment = (res.data || [])[0];
  }

  if (!enrollment) return { success: false, error: 'ENROLLMENT_NOT_FOUND' };
  if (enrollment.status !== 'PAID') return { success: false, error: 'INVALID_STATUS' };

  const rush = (await db.collection('court_rush').doc(enrollment.court_rush_id).get()).data;
  if (!rush) return { success: false, error: 'RUSH_NOT_FOUND' };

  const startAt = new Date(rush.start_at);
  const now = new Date();
  const hours = (startAt - now) / (1000 * 60 * 60);
  if (hours < 6) return { success: false, error: 'REFUND_WINDOW_CLOSED' };

  const paymentRes = await db.collection('court_rush_payment').where({ enrollment_id: enrollment._id }).limit(1).get();
  const payment = (paymentRes.data || [])[0];
  if (!payment || payment.status !== 'PAIDED') {
    return { success: false, error: 'PAYMENT_NOT_REFUNDABLE' };
  }

  await db.collection('court_rush_payment').doc(payment._id).update({
    data: { status: 'REFUNDING', updated_at: db.serverDate() },
  });
  await db.collection('court_rush_enrollment').doc(enrollment._id).update({
    data: { status: 'CANCEL_REQUESTED', updated_at: db.serverDate() },
  });

  const refundRes = await cloud.cloudPay.refund({
    out_refund_no: `${payment.outTradeNo}_R`,
    out_trade_no: payment.outTradeNo,
    total_fee: Math.round(Number(payment.total_fee_yuan || 0) * 100),
    refund_fee: Math.round(Number(payment.total_fee_yuan || 0) * 100),
    nonce_str: nonceStr || generateNonce(),
    subMchId: '1716570749',
    envId: 'cloud1-6gebob4m4ba8f3de',
    functionName: 'court_rush_refund_callback',
  });

  return { success: true, refund: refundRes };
};
