const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const FOUR_PERSON_RUSH_SIZE = 4;
const MIN_PAID_PARTICIPANTS = 2;

function shouldAutoCancel(rush) {
  const activeParticipants = Number(rush.current_participants || 0) + Number(rush.held_participants || 0);
  return Number(rush.max_participants || 0) === FOUR_PERSON_RUSH_SIZE
    && activeParticipants < MIN_PAID_PARTICIPANTS;
}

function isUpcomingRush(rush, now, thresholdTime) {
  const startAt = new Date(rush.start_at).getTime();
  return rush.status === 'OPEN'
    && !rush.deleted_at
    && startAt > now.getTime()
    && startAt <= thresholdTime.getTime();
}

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

async function refundPaidEnrollments(db, rushId) {
  const enrollRes = await db.collection('court_rush_enrollment').where({
    court_rush_id: rushId,
    status: 'PAID',
    deleted_at: db.command.eq(null),
  }).get();
  const enrollments = enrollRes.data || [];
  let failed = 0;
  for (const enrollment of enrollments) {
    const payRes = await db.collection('court_rush_payment').where({
      enrollment_id: enrollment._id,
      status: 'PAIDED',
      deleted_at: db.command.eq(null),
    }).limit(1).get();
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
  return { count: enrollments.length, failed };
}

async function finalizeAutoCancel(db, rush) {
  const enrollRes = await db.collection('court_rush_enrollment').where({
    court_rush_id: rush._id,
    status: 'PAID',
    deleted_at: db.command.eq(null),
  }).get();
  const hasPaid = (enrollRes.data || []).length > 0;

  await db.collection('court_rush').doc(rush._id).update({
    data: {
      status: 'CANCELLED',
      ...(hasPaid ? { cancel_refund_status: 'PROCESSING' } : { auto_cancel_status: 'DONE' }),
      cancelled_at: db.serverDate(),
      deleted_at: db.serverDate(),
      updated_at: db.serverDate(),
    },
  });

  await db.collection('court_order_collection').where({
    source_type: 'COURT_RUSH',
    rush_id: rush._id,
  }).remove();

  if (hasPaid) {
    const { failed } = await refundPaidEnrollments(db, rush._id);
    await db.collection('court_rush').doc(rush._id).update({
      data: { cancel_refund_status: failed > 0 ? 'PARTIAL_FAILED' : 'DONE', updated_at: db.serverDate() },
    });
  }
}

async function checkAndFinalizeCancel(db, rushId) {
  const rush = await db.collection('court_rush').doc(rushId).get();
  const data = rush.data;
  if (!data || data.deleted_at || data.status !== 'OPEN') return;
  if (new Date(data.start_at).getTime() > Date.now() && shouldAutoCancel(data)) {
    await finalizeAutoCancel(db, data);
    return;
  }

  await db.collection('court_rush').where({
    _id: rushId,
    status: 'OPEN',
    auto_cancel_status: 'PROCESSING',
  }).update({
    data: {
      auto_cancel_status: 'NOT_STARTED',
      updated_at: db.serverDate(),
    },
  });
}

exports.main = async (event) => {
  const db = cloud.database();
  const now = new Date();
  const thresholdTime = new Date(now.getTime() + 30 * 60 * 1000);

  const rushes = await db.collection('court_rush').where({
    start_at: db.command.gt(now).and(db.command.lte(thresholdTime)),
  }).get();

  const openRushes = (rushes.data || []).filter((rush) => isUpcomingRush(rush, now, thresholdTime));
  for (const rush of openRushes) {
    await processExpiredHeldOrders(db, rush._id, now);

    const latestRes = await db.collection('court_rush').doc(rush._id).get();
    const latest = latestRes.data;
    if (latest && isUpcomingRush(latest, now, thresholdTime) && shouldAutoCancel(latest)) {
      const updateRes = await db.collection('court_rush').where({
        _id: latest._id,
        max_participants: FOUR_PERSON_RUSH_SIZE,
        current_participants: Number(latest.current_participants || 0),
        held_participants: Number(latest.held_participants || 0),
        status: 'OPEN',
        auto_cancel_status: db.command.neq('PROCESSING'),
      }).update({
        data: {
          auto_cancel_status: 'PROCESSING',
          updated_at: db.serverDate(),
        },
      });
      if (updateRes.stats && updateRes.stats.updated === 1) {
        await checkAndFinalizeCancel(db, latest._id);
      }
    }
  }

  return { success: true };
};
