const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function isAdminManager(manager) {
  if (!manager || typeof manager !== 'object') return false;
  const courtRushManager = Number(manager.courtRushManager || 0);
  const specialManager = Number(manager.specialManager || 0);
  return courtRushManager >= 1 || specialManager >= 1;
}

exports.main = async (event) => {
  const db = cloud.database();
  const { rushId, enrollmentId, phoneNumber } = event || {};
  if (!rushId || !enrollmentId || !phoneNumber) return { success: false, error: 'INVALID_PARAMS' };

  const managerRes = await db.collection('manager').where({ phoneNumber }).limit(1).get();
  const manager = (managerRes.data || [])[0];
  if (!isAdminManager(manager)) return { success: false, error: 'NO_PERMISSION' };

  const enrollRes = await db.collection('court_rush_enrollment').doc(enrollmentId).get();
  const enroll = enrollRes.data;
  if (!enroll || enroll.court_rush_id !== rushId) return { success: false, error: 'NOT_FOUND' };

  let paidAmountYuan = null;
  const payRes = await db.collection('court_rush_payment').where({
    enrollment_id: enrollmentId,
    deleted_at: db.command.eq(null),
  }).limit(1).get();
  const pay = (payRes.data || [])[0];
  if (pay && pay.status === 'PAIDED') paidAmountYuan = Number(pay.total_fee_yuan);

  return {
    success: true,
    data: {
      nickName: enroll.nickName || '微信用户',
      avatarUrl: enroll.avatarUrl || '',
      phoneNumber: enroll.phoneNumber || '',
      paidAmountYuan,
    },
  };
};
