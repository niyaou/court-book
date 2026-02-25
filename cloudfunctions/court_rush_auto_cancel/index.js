const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function generateNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i += 1) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

async function processExpiredHeldOrders(db, rushId, now) {
  const expiredEnrollments = await db.collection('court_rush_enrollment').where({
    court_rush_id: rushId,
    status: 'PENDING_PAYMENT',
    expires_at: db.command.lt(now),
    deleted_at: db.command.eq(null),
  }).get();

  for (const enroll of expiredEnrollments.data || []) {
    const up = await db.collection('court_rush_enrollment').where({
      _id: enroll._id,
      status: 'PENDING_PAYMENT',
    }).update({
      data: { status: 'EXPIRED', updated_at: db.serverDate() },
    });

    if (up.stats && up.stats.updated === 1) {
      await db.collection('court_rush').where({
        _id: rushId,
        held_participants: db.command.gt(0),
      }).update({
        data: { held_participants: db.command.inc(-1), updated_at: db.serverDate() },
      });
    }
  }
}

async function finalizeAutoCancel(db, rush) {
  await db.collection('court_rush').doc(rush._id).update({
    data: {
      status: 'CANCELLED',
      auto_cancel_status: 'DONE',
      cancelled_at: db.serverDate(),
      deleted_at: db.serverDate(),
      updated_at: db.serverDate(),
    },
  });

  await db.collection('court_order_collection').where({
    source_type: 'COURT_RUSH',
    rush_id: rush._id,
  }).remove();
}

async function checkAndFinalizeCancel(db, rushId) {
  const rush = await db.collection('court_rush').doc(rushId).get();
  const data = rush.data;
  if (!data) return;

  if (data.current_participants === 0 && data.held_participants === 0) {
    await finalizeAutoCancel(db, data);
  }
}

exports.main = async (event) => {
  const db = cloud.database();
  const now = new Date();
  const thresholdTime = new Date(now.getTime() + 15 * 60 * 1000);

  const rushes = await db.collection('court_rush').where({
    status: db.command.neq('CANCELLED'),
    auto_cancel_status: db.command.neq('PROCESSING'),
    deleted_at: db.command.eq(null),
  }).get();

  const filteredRushes = (rushes.data || []).filter((rush) => {
    const startAt = new Date(rush.start_at);
    const startAtUTC = startAt.getTime();
    const nowUTC = now.getTime();
    const thresholdUTC = thresholdTime.getTime();
    return (startAtUTC > nowUTC && startAtUTC <= thresholdUTC) || startAtUTC <= nowUTC;
  });

  for (const rush of filteredRushes) {
    const total = Number(rush.current_participants || 0) + Number(rush.held_participants || 0);
    if (total < 2) {
      const updateRes = await db.collection('court_rush').where({
        _id: rush._id,
        auto_cancel_status: db.command.neq('PROCESSING'),
      }).update({
        data: {
          auto_cancel_status: 'PROCESSING',
          updated_at: db.serverDate(),
        },
      });

      if (updateRes.stats && updateRes.stats.updated === 1) {
        await processExpiredHeldOrders(db, rush._id, now);
        await checkAndFinalizeCancel(db, rush._id);
      }
    }
  }

  return { success: true };
};
