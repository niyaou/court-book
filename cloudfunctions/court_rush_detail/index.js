const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

async function cleanupExpiredEnrollments(db, rushId) {
  const now = new Date();
  const where = {
    status: 'PENDING_PAYMENT',
    expires_at: db.command.lt(now),
    deleted_at: db.command.eq(null),
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

  console.log('[court_rush_detail] 触发 court_rush_auto_cancel');
  cloud.callFunction({
    name: 'court_rush_auto_cancel',
    data: {},
  }).then(() => console.log('[court_rush_detail] court_rush_auto_cancel 调用成功')).catch((err) => {
    console.error('[court_rush_detail] 自动取消扫描失败', err);
  });

  await cleanupExpiredEnrollments(db, rushId);

  const rushRes = await db.collection('court_rush').doc(rushId).get();
  const rush = rushRes.data;
  if (!rush || rush.deleted_at) return { success: false, error: 'RUSH_NOT_FOUND' };

  let myEnrollment = null;
  let myPayment = null;
  if (phoneNumber) {
    const enrollRes = await db.collection('court_rush_enrollment').where({
      court_rush_id: rushId,
      phoneNumber,
      deleted_at: db.command.eq(null),
    }).limit(1).get();
    myEnrollment = (enrollRes.data || [])[0] || null;
    if (myEnrollment) {
      const payRes = await db.collection('court_rush_payment').where({
        enrollment_id: myEnrollment._id,
        deleted_at: db.command.eq(null),
      }).limit(1).get();
      myPayment = (payRes.data || [])[0] || null;
    }
  }

  const now = event.clientNow != null ? new Date(event.clientNow) : new Date();
  const startMs = new Date(rush.start_at).getTime();
  const endMs = new Date(rush.end_at).getTime();
  const hoursUntilStart = (startMs - now.getTime()) / (1000 * 60 * 60);
  const canRefund = !!(myEnrollment && myEnrollment.status === 'PAID' && hoursUntilStart >= 6);

  const participantsRes = await db.collection('court_rush_enrollment').where({
    court_rush_id: rushId,
    status: db.command.in(['PENDING_PAYMENT', 'PAID']),
    deleted_at: db.command.eq(null),
  }).get();

  const participants = (participantsRes.data || []).map((enroll) => ({
    nickName: enroll.nickName || '微信用户',
    avatarUrl: enroll.avatarUrl || '',
    enrollmentId: enroll._id,
  }));

  const current = Number(rush.current_participants || 0);
  const held = Number(rush.held_participants || 0);
  const total = current + held;
  const max = Number(rush.max_participants || 0);
  const firstId = rush.court_ids && (Array.isArray(rush.court_ids) ? rush.court_ids[0] : rush.court_ids);
  const court_number = firstId ? String(firstId).split('_')[0] || '' : '';

  // 畅打规则：rules 表 type=rush 取一条，仅返回 title、content
  let rushRule = null;
  try {
    const ruleRes = await db.collection('rules').where({ type: 'rush' }).limit(1).get();
    const rule = (ruleRes.data || [])[0];
    if (rule) rushRule = { title: rule.title || '', content: rule.content || '' };
  } catch (e) { /* 忽略，前端不展示 */ }

  const canCancelRush = !rush.deleted_at
    && rush.status !== 'CANCELLED'
    && !Number.isNaN(endMs)
    && now.getTime() < endMs;

  return {
    success: true,
    data: {
      rush: { ...rush, court_number },
      myEnrollment,
      myPayment,
      canRefund,
      canEnroll: !rush.deleted_at
        && rush.status !== 'CANCELLED'
        && !Number.isNaN(startMs)
        && !Number.isNaN(endMs)
        && now.getTime() < startMs
        && now.getTime() < endMs
        && (max <= 0 || total < max),
      canCancelRush,
      display_participants: total,
      participants,
      rushRule,
    },
  };
};
