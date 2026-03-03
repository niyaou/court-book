const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 用户取消本人未支付报名（不涉及退款）
exports.main = async (event) => {
  const db = cloud.database();
  const { enrollment_id, phoneNumber } = event || {};
  if (!enrollment_id || !phoneNumber) return { success: false, error: 'INVALID_PARAMS' };

  const enrollRes = await db.collection('court_rush_enrollment').doc(enrollment_id).get();
  const enrollment = enrollRes.data;
  if (!enrollment || enrollment.deleted_at) return { success: false, error: 'ENROLLMENT_NOT_FOUND' };
  if (enrollment.phoneNumber !== phoneNumber) return { success: false, error: 'FORBIDDEN' };
  if (enrollment.status !== 'PENDING_PAYMENT') return { success: false, error: 'INVALID_STATUS' };

  const rushId = enrollment.court_rush_id;
  await db.collection('court_rush_enrollment').doc(enrollment_id).update({
    data: { status: 'CANCELLED', updated_at: db.serverDate() },
  });

  const payRes = await db.collection('court_rush_payment').where({
    enrollment_id,
    deleted_at: db.command.eq(null),
  }).limit(1).get();
  const pay = (payRes.data || [])[0];
  if (pay) {
    await db.collection('court_rush_payment').doc(pay._id).update({
      data: { status: 'CANCEL', updated_at: db.serverDate() },
    });
  }

  await db.collection('court_rush').where({
    _id: rushId,
    held_participants: db.command.gt(0),
  }).update({
    data: { held_participants: db.command.inc(-1), updated_at: db.serverDate() },
  });

  return { success: true };
};
