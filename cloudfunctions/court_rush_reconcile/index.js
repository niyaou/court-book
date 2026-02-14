const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

async function reconcileOne(db, rush) {
  const now = new Date();
  const enrollRes = await db.collection('court_rush_enrollment').where({ court_rush_id: rush._id }).get();
  const enrollments = enrollRes.data || [];

  const held = enrollments.filter((e) => e.status === 'PENDING_PAYMENT' && e.expires_at && new Date(e.expires_at) > now).length;
  const paid = enrollments.filter((e) => e.status === 'PAID').length;

  await db.collection('court_rush').doc(rush._id).update({
    data: {
      held_participants: held,
      current_participants: paid,
      updated_at: db.serverDate(),
    },
  });

  return { rushId: rush._id, held, paid };
}

exports.main = async (event) => {
  const db = cloud.database();
  const rushId = event.court_rush_id || event.rushId;

  let rushes = [];
  if (rushId) {
    const one = await db.collection('court_rush').doc(rushId).get();
    if (one.data) rushes = [one.data];
  } else {
    const all = await db.collection('court_rush').limit(100).get();
    rushes = all.data || [];
  }

  const results = [];
  for (const rush of rushes) {
    results.push(await reconcileOne(db, rush));
  }

  return { success: true, results };
};
