const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

async function cleanupExpiredEnrollments(db, rushId) {
  const now = new Date();
  const where = {
    status: 'PENDING_PAYMENT',
    expires_at: db.command.lt(now),
  };
  if (rushId) where.court_rush_id = rushId;

  const expiredRes = await db.collection('court_rush_enrollment').where(where).get();
  const expiredRows = expiredRes.data || [];

  for (const row of expiredRows) {
    const up = await db.collection('court_rush_enrollment').where({
      _id: row._id,
      status: 'PENDING_PAYMENT',
    }).update({
      data: {
        status: 'EXPIRED',
        updated_at: db.serverDate(),
      },
    });

    if (up.stats && up.stats.updated === 1 && row.court_rush_id) {
      await db.collection('court_rush').where({
        _id: row.court_rush_id,
        held_participants: db.command.gt(0),
      }).update({
        data: {
          held_participants: db.command.inc(-1),
          updated_at: db.serverDate(),
        },
      });
    }
  }
}

exports.main = async (event) => {
  const db = cloud.database();
  const rushId = event.rushId || event.court_rush_id;
  const phoneNumber = event.phoneNumber;

  if (!rushId) return { success: false, error: 'MISSING_RUSH_ID' };

  await cleanupExpiredEnrollments(db, rushId);

  const rushRes = await db.collection('court_rush').doc(rushId).get();
  const rush = rushRes.data;
  if (!rush) return { success: false, error: 'RUSH_NOT_FOUND' };

  let myEnrollment = null;
  let myPayment = null;
  if (phoneNumber) {
    const enrollRes = await db.collection('court_rush_enrollment').where({ court_rush_id: rushId, phoneNumber }).limit(1).get();
    myEnrollment = (enrollRes.data || [])[0] || null;
    if (myEnrollment) {
      const payRes = await db.collection('court_rush_payment').where({ enrollment_id: myEnrollment._id }).limit(1).get();
      myPayment = (payRes.data || [])[0] || null;
    }
  }

  const canRefund = myEnrollment && myEnrollment.status === 'PAID' && (new Date(rush.start_at) - new Date()) / (1000 * 60 * 60) >= 6;

  const participantsRes = await db.collection('court_rush_enrollment').where({
    court_rush_id: rushId,
    status: db.command.in(['PENDING_PAYMENT', 'PAID']),
  }).get();

  const participants = (participantsRes.data || []).map((enroll) => ({
    nickName: enroll.nickName || '微信用户',
    avatarUrl: enroll.avatarUrl || '',
  }));

  const current = Number(rush.current_participants || 0);
  const held = Number(rush.held_participants || 0);

  return {
    success: true,
    data: {
      rush,
      myEnrollment,
      myPayment,
      canRefund,
      canEnroll: rush.status === 'OPEN',
      display_participants: current + held,
      participants,
    },
  };
};
