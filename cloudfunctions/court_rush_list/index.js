const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

async function cleanupExpiredEnrollments(db) {
  const now = new Date();
  const expiredRes = await db.collection('court_rush_enrollment').where({
    status: 'PENDING_PAYMENT',
    expires_at: db.command.lt(now),
    deleted_at: db.command.eq(null),
  }).get();

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
  const {
    phoneNumber,
    campus,
    limit = 100,
    page = 1,
    pageSize = 20,
  } = event || {};
  const now = new Date();

  console.log('[court_rush_list] 触发 court_rush_auto_cancel');
  cloud.callFunction({
    name: 'court_rush_auto_cancel',
    data: {},
  }).then(() => console.log('[court_rush_list] court_rush_auto_cancel 调用成功')).catch((err) => {
    console.error('[court_rush_list] 自动取消扫描失败', err);
  });

  await cleanupExpiredEnrollments(db);

  let isRushManager = false;
  if (phoneNumber) {
    const managerRes = await db.collection('manager').where({ phoneNumber }).limit(1).get();
    const manager = (managerRes.data || [])[0];
    isRushManager = manager && (Number(manager.courtRushManager || 0) >= 1 || Number(manager.specialManager || 0) >= 1);
  }

  const where = {};
  if (campus) where.campus = campus;
  where.deleted_at = db.command.eq(null);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const baseStart = isRushManager ? new Date(todayStart.getTime() - sevenDaysMs) : todayStart;
  where.start_at = db.command.gte(baseStart);

  function courtNumberFromCourtIds(courtIds) {
    const first = Array.isArray(courtIds) ? courtIds[0] : (typeof courtIds === 'string' ? courtIds : null);
    if (first == null || first === '') return '';
    return String(first).split('_')[0] || '';
  }

  const rushRes = await db.collection('court_rush').where(where).limit(Number(limit)).get();
  const rows = (rushRes.data || []).map((row) => {
    const startAt = new Date(row.start_at);
    const notStarted = startAt >= now;
    const current = Number(row.current_participants || 0);
    const held = Number(row.held_participants || 0);
    return {
      ...row,
      court_number: courtNumberFromCourtIds(row.court_ids),
      display_participants: current + held,
      weak_display: !notStarted,
      not_started: notStarted,
    };
  }).filter((row) => {
    if (row.status === 'CANCELLED' && !isRushManager) {
      return false;
    }
    return true;
  });

  rows.sort((a, b) => new Date(b.start_at) - new Date(a.start_at));

  const size = Number(pageSize) > 0 ? Number(pageSize) : 20;
  const pageNum = Number(page) > 0 ? Number(page) : 1;
  const startIndex = (pageNum - 1) * size;
  const pagedRows = rows.slice(startIndex, startIndex + size);

  if (phoneNumber && pagedRows.length) {
    const ids = pagedRows.map((r) => r._id);
    const enrollRes = await db.collection('court_rush_enrollment').where({
      court_rush_id: db.command.in(ids),
      phoneNumber,
      deleted_at: db.command.eq(null),
    }).get();

    const map = new Map((enrollRes.data || []).map((e) => [e.court_rush_id, e]));
    pagedRows.forEach((r) => {
      r.my_enrollment = map.get(r._id) || null;
    });
  }

  return { success: true, data: pagedRows };
};
