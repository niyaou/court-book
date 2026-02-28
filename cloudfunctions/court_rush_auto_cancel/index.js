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
  if (!data) return;
  const total = Number(data.current_participants || 0) + Number(data.held_participants || 0);
  if (total < 2) await finalizeAutoCancel(db, data);
}

exports.main = async (event) => {
  const db = cloud.database();
  const now = new Date();
  const thresholdTime = new Date(now.getTime() + 30 * 60 * 1000);

  const rushes = await db.collection('court_rush').where({
    status: db.command.neq('CANCELLED'),
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
      }
      await checkAndFinalizeCancel(db, rush._id);
    }
  }

  return { success: true };
};
