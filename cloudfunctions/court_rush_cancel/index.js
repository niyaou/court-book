const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function isAdminManager(manager) {
  if (!manager || typeof manager !== 'object') return false;
  const courtRushManager = Number(manager.courtRushManager || 0);
  const specialManager = Number(manager.specialManager || 0);
  return courtRushManager >= 1 || specialManager >= 1;
}

function generateNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i += 1) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

exports.main = async (event) => {
  const db = cloud.database();
  const rushId = event.court_rush_id || event.rushId;
  const operatorPhone = event.phoneNumber;

  if (!rushId || !operatorPhone) return { success: false, error: 'INVALID_PARAMS' };

  const managerRes = await db.collection('manager').where({ phoneNumber: operatorPhone }).limit(1).get();
  const manager = (managerRes.data || [])[0];
  if (!isAdminManager(manager)) {
    return { success: false, error: 'NO_PERMISSION' };
  }

  const rushRes = await db.collection('court_rush').doc(rushId).get();
  const rush = rushRes.data;
  if (!rush) return { success: false, error: 'RUSH_NOT_FOUND' };

  await db.collection('court_rush').doc(rushId).update({
    data: {
      status: 'CANCELLED',
      cancel_refund_status: 'PROCESSING',
      cancelled_at: db.serverDate(),
      updated_at: db.serverDate(),
    },
  });

  await db.collection('court_order_collection').where({
    source_type: 'COURT_RUSH',
    rush_id: rushId,
  }).remove();

  const enrollRes = await db.collection('court_rush_enrollment').where({ court_rush_id: rushId, status: 'PAID' }).get();
  const enrollments = enrollRes.data || [];

  let failed = 0;
  for (const enrollment of enrollments) {
    const payRes = await db.collection('court_rush_payment').where({ enrollment_id: enrollment._id, status: 'PAIDED' }).limit(1).get();
    const payment = (payRes.data || [])[0];
    if (!payment) continue;

    try {
      await db.collection('court_rush_payment').doc(payment._id).update({ data: { status: 'REFUNDING', updated_at: db.serverDate() } });
      await db.collection('court_rush_enrollment').doc(enrollment._id).update({ data: { status: 'CANCEL_REQUESTED', updated_at: db.serverDate() } });
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
      failed += 1;
    }
  }

  await db.collection('court_rush').doc(rushId).update({
    data: {
      cancel_refund_status: failed > 0 ? 'PARTIAL_FAILED' : 'DONE',
      updated_at: db.serverDate(),
    },
  });

  return { success: true, failed };
};
