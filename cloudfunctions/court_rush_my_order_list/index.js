const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const db = cloud.database();
  const { phoneNumber, pageNum = 1, pageSize = 20 } = event || {};
  if (!phoneNumber) return { success: false, error: 'MISSING_PHONE' };

  const managerRes = await db.collection('manager').where({ phoneNumber }).limit(1).get();
  const manager = (managerRes.data || [])[0];
  const isRushManager = manager && (Number(manager.courtRushManager || 0) >= 1 || Number(manager.specialManager || 0) >= 1);

  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

  const query = {
    phoneNumber,
    _: db.command.or([
      { status: 'PAIDED' },
      { status: 'REFUNDED' },
      { status: 'REFUNDING' },
      {
        status: 'PENDING',
        createTime: db.command.gte(fiveMinutesAgo),
      },
    ]),
  };

  const skip = (Number(pageNum) - 1) * Number(pageSize);
  const payRes = await db.collection('court_rush_payment')
    .where(query)
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(Number(pageSize))
    .get();

  const rows = payRes.data || [];
  const rushIds = Array.from(new Set(rows.map((r) => r.court_rush_id).filter(Boolean)));
  const enrollIds = Array.from(new Set(rows.map((r) => r.enrollment_id).filter(Boolean)));

  const rushMap = new Map();
  const enrollMap = new Map();

  if (rushIds.length) {
    const rushRes = await db.collection('court_rush').where({ _id: db.command.in(rushIds) }).get();
    (rushRes.data || []).forEach((r) => rushMap.set(r._id, r));
  }

  if (enrollIds.length) {
    const enrollRes = await db.collection('court_rush_enrollment').where({ _id: db.command.in(enrollIds) }).get();
    (enrollRes.data || []).forEach((e) => enrollMap.set(e._id, e));
  }

  const data = rows.map((row) => {
    const rush = rushMap.get(row.court_rush_id);
    const enroll = enrollMap.get(row.enrollment_id);
    return {
      ...row,
      order_type: 'RUSH',
      total_fee: row.total_fee_yuan,
      createTime: row.createTime || row.created_at,
      court_ids: rush ? rush.court_ids : [],
      campus: rush ? rush.campus : '',
      title: rush ? `畅打 ${rush.campus}` : '畅打订单',
      canPay: row.status === 'PENDING',
      canRefund: !!(enroll && enroll.status === 'PAID' && rush && (new Date(rush.start_at) - now) / (1000 * 60 * 60) >= 6),
      rushStatus: rush ? rush.status : null,
    };
  }).filter((item) => {
    if (item.rushStatus === 'CANCELLED' && !isRushManager) {
      return false;
    }
    return true;
  });

  return { success: true, data };
};
