const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

async function cleanupExpiredEnrollments(db) {
  const now = new Date();
  const expiredRes = await db.collection('court_rush_enrollment').where({
    status: 'PENDING_PAYMENT',
    expires_at: db.command.lt(now),
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
  const { phoneNumber, campus, limit = 100 } = event || {};

  await cleanupExpiredEnrollments(db);

  const where = {};
  if (campus) where.campus = campus;

  const rushRes = await db.collection('court_rush').where(where).limit(Number(limit)).get();
  const now = new Date();
  const rows = (rushRes.data || []).map((row) => {
    const startAt = new Date(row.start_at);
    const notStarted = startAt >= now;
    return {
      ...row,
      weak_display: !notStarted,
      not_started: notStarted,
    };
  });

  rows.sort((a, b) => {
    if (a.not_started !== b.not_started) return a.not_started ? -1 : 1;
    return new Date(b.start_at) - new Date(a.start_at);
  });

  if (phoneNumber && rows.length) {
    const ids = rows.map((r) => r._id);
    const enrollRes = await db.collection('court_rush_enrollment').where({
      court_rush_id: db.command.in(ids),
      phoneNumber,
    }).get();

    const map = new Map((enrollRes.data || []).map((e) => [e.court_rush_id, e]));
    rows.forEach((r) => {
      r.my_enrollment = map.get(r._id) || null;
    });
  }

  return { success: true, data: rows };
};
