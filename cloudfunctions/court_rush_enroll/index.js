const cloud = require('wx-server-sdk');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function generateOrderNo(input) {
  const raw = `${input.phoneNumber || ''}${input.court_rush_id || ''}${Date.now()}${Math.random()}`;
  return crypto.createHash('md5').update(raw).digest('hex').substring(0, 32);
}

function formatTimeExpire(date) {
  const beijingOffset = 8 * 60 * 60 * 1000;
  const beijingTime = new Date(date.getTime() + beijingOffset);
  const pad = (num) => String(num).padStart(2, '0');
  return `${beijingTime.getUTCFullYear()}${pad(beijingTime.getUTCMonth() + 1)}${pad(beijingTime.getUTCDate())}${pad(beijingTime.getUTCHours())}${pad(beijingTime.getUTCMinutes())}${pad(beijingTime.getUTCSeconds())}`;
}

async function getVipInfo(phoneNumber) {
  const dbConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  };

  if (!dbConfig.host || !dbConfig.user || !dbConfig.password || !dbConfig.database) {
    console.warn('[getVipInfo] 外部库配置缺失，跳过查询', { hasHost: !!dbConfig.host, hasUser: !!dbConfig.user });
    return { isVip: false, balance: 0 };
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute('SELECT rest_charge, annual_count, times_count FROM prepaid_card WHERE number = ? LIMIT 1', [phoneNumber]);
    if (!rows.length) {
      console.log('[getVipInfo] 未查到会员', { phoneNumber: phoneNumber ? `${phoneNumber.slice(0, 3)}****` : '' });
      return { isVip: false, balance: 0 };
    }
    const row = rows[0];
    const balance = Number(row.rest_charge || 0) + Number(row.annual_count || 0) * 150 + Number(row.times_count || 0) * 150;
    const isVip = balance > 0;
    console.log('[getVipInfo] 查询成功', { phoneNumber: phoneNumber ? `${phoneNumber.slice(0, 3)}****` : '', isVip, balance, rest_charge: row.rest_charge, annual_count: row.annual_count, times_count: row.times_count });
    return { isVip, balance };
  } catch (err) {
    console.error('[getVipInfo] 查询失败', { phoneNumber: phoneNumber ? `${phoneNumber.slice(0, 3)}****` : '', message: err.message, code: err.code });
    return { isVip: false, balance: 0 };
  } finally {
    if (connection) {
      await connection.end().catch(() => {});
    }
  }
}

async function decrementHeld(db, rushId) {
  await db.collection('court_rush').where({ _id: rushId, held_participants: db.command.gt(0) }).update({
    data: {
      held_participants: db.command.inc(-1),
      updated_at: db.serverDate(),
    },
  });
}

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
  const _ = db.command;

  const phoneNumber = event.phoneNumber;
  const openid = event.openid;
  const nonceStr = event.nonceStr;
  const court_rush_id = event.court_rush_id || event.rushId;
  const nickName = event.nickName;
  const avatarUrl = event.avatarUrl;

  if (!phoneNumber || !openid || !court_rush_id) {
    return { success: false, error: 'INVALID_PARAMS', message: 'Missing required fields' };
  }

  if (!nickName || typeof nickName !== 'string' || !nickName.trim()) {
    return { success: false, error: 'INVALID_PARAMS', message: 'nickName is required' };
  }

  if (!avatarUrl || typeof avatarUrl !== 'string' || !avatarUrl.trim()) {
    return { success: false, error: 'INVALID_PARAMS', message: 'avatarUrl is required' };
  }

  await cleanupExpiredEnrollments(db, court_rush_id);

  const rushRes = await db.collection('court_rush').doc(court_rush_id).get();
  const rush = rushRes.data;
  if (!rush || rush.deleted_at) return { success: false, error: 'RUSH_NOT_FOUND' };
  if (rush.status !== 'OPEN') return { success: false, error: 'RUSH_NOT_OPEN' };

  const now = new Date();
  const existingRes = await db.collection('court_rush_enrollment').where({
    court_rush_id,
    phoneNumber,
    deleted_at: db.command.eq(null),
  }).limit(1).get();
  const existing = (existingRes.data || [])[0];

  if (existing && existing.status === 'PAID') {
    return { success: false, error: 'ALREADY_JOINED' };
  }

  if (existing && existing.status === 'PENDING_PAYMENT') {
    const payRes = await db.collection('court_rush_payment').where({
      enrollment_id: existing._id,
      status: 'PENDING',
      deleted_at: db.command.eq(null),
    }).limit(1).get();
    const pay = (payRes.data || [])[0];
    const enrollmentValid = existing.expires_at && new Date(existing.expires_at) > now;
    const payValid = pay && pay.paymentExpireTime && new Date(pay.paymentExpireTime) > now;
    if (enrollmentValid && payValid) {
      return {
        success: true,
        enrollment_id: existing._id,
        paymentId: pay._id,
        payment: pay.payment_parmas || pay.payment_params,
        status: 'PENDING_PAYMENT',
      };
    }
    // 报名/支付已过期：取消本次，按未报名处理，不新建 payment
    await db.collection('court_rush_enrollment').doc(existing._id).update({
      data: { status: 'CANCELLED', updated_at: db.serverDate() },
    });
    const expiredPayRes = await db.collection('court_rush_payment').where({
      enrollment_id: existing._id,
      deleted_at: db.command.eq(null),
    }).limit(1).get();
    const expiredPay = (expiredPayRes.data || [])[0];
    if (expiredPay) {
      await db.collection('court_rush_payment').doc(expiredPay._id).update({
        data: { status: 'CANCEL', updated_at: db.serverDate() },
      });
    }
    await db.collection('court_rush').where({
      _id: court_rush_id,
      held_participants: db.command.gt(0),
    }).update({
      data: { held_participants: db.command.inc(-1), updated_at: db.serverDate() },
    });
    return { success: false, error: 'ENROLLMENT_EXPIRED', message: '报名已过期' };
  }

  let gateOk = false;
  for (let i = 0; i < 3; i += 1) {
    const latest = (await db.collection('court_rush').doc(court_rush_id).get()).data;
    if (!latest || latest.deleted_at || latest.status !== 'OPEN') return { success: false, error: 'RUSH_NOT_OPEN' };
    if (latest.auto_cancel_status === 'PROCESSING') {
      return { success: false, error: 'RUSH_CANCELLING' };
    }
    if (Number(latest.current_participants || 0) + Number(latest.held_participants || 0) >= Number(latest.max_participants || 0)) {
      return { success: false, error: '畅打已满员，请稍后再试' };
    }

    const gateRes = await db.collection('court_rush').where({
      _id: court_rush_id,
      status: 'OPEN',
      held_participants: Number(latest.held_participants || 0),
      current_participants: Number(latest.current_participants || 0),
    }).update({
      data: {
        held_participants: _.inc(1),
        updated_at: db.serverDate(),
      },
    });

    if (gateRes.stats && gateRes.stats.updated === 1) {
      gateOk = true;
      break;
    }
  }

  if (!gateOk) {
    return { success: false, error: '畅打已满员，请稍后再试' };
  }

  try {
    const vipInfo = await getVipInfo(phoneNumber);
    const basePrice = Number(rush.price_per_person_yuan || 0);
    const courtFee = vipInfo.isVip ? Math.ceil(basePrice / 2) : basePrice;
    const lightingFee = Number(rush.lighting_fee_yuan || 0);
    const actualFee = courtFee + lightingFee;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    let enrollmentId = existing && existing._id;
    if (enrollmentId) {
      await db.collection('court_rush_enrollment').doc(enrollmentId).update({
        data: {
          status: 'PENDING_PAYMENT',
          is_vip: vipInfo.isVip,
          actual_fee_yuan: actualFee,
          expires_at: expiresAt,
          nickName: nickName.trim(),
          avatarUrl: avatarUrl.trim(),
          updated_at: db.serverDate(),
        },
      });
    } else {
      const addEnroll = await db.collection('court_rush_enrollment').add({
        data: {
          court_rush_id,
          phoneNumber,
          status: 'PENDING_PAYMENT',
          is_vip: vipInfo.isVip,
          actual_fee_yuan: actualFee,
          expires_at: expiresAt,
          nickName: nickName.trim(),
          avatarUrl: avatarUrl.trim(),
          created_at: db.serverDate(),
          updated_at: db.serverDate(),
        },
      });
      enrollmentId = addEnroll._id;
    }

    const outTradeNo = generateOrderNo({ phoneNumber, court_rush_id });
    const paymentExpireTime = new Date(Date.now() + 4 * 60 * 1000);
    const payRes = await cloud.cloudPay.unifiedOrder({
      outTradeNo,
      body: 'court rush payment',
      totalFee: Math.round(actualFee * 100),
      subMchId: '1716570749',
      nonceStr: nonceStr || generateOrderNo({ phoneNumber }).substring(0, 32),
      openid,
      spbillCreateIp: '127.0.0.1',
      envId: 'cloud1-6gebob4m4ba8f3de',
      tradeType: 'JSAPI',
      timeExpire: formatTimeExpire(paymentExpireTime),
      functionName: 'court_rush_order_callback',
    });

    const existingPayRes = await db.collection('court_rush_payment').where({
      enrollment_id: enrollmentId,
      deleted_at: db.command.eq(null),
    }).limit(1).get();
    const existingPay = (existingPayRes.data || [])[0];
    if (existingPay) {
      await db.collection('court_rush_payment').doc(existingPay._id).update({
        data: {
          outTradeNo,
          phoneNumber,
          court_rush_id,
          enrollment_id: enrollmentId,
          total_fee_yuan: actualFee,
          status: 'PENDING',
          payment_params: payRes.payment,
          paymentExpireTime,
          paymentQueryTime: null,
          updated_at: db.serverDate(),
        },
      });
      return { success: true, enrollment_id: enrollmentId, paymentId: existingPay._id, payment: payRes.payment };
    }

    const addPay = await db.collection('court_rush_payment').add({
      data: {
        outTradeNo,
        phoneNumber,
        court_rush_id,
        enrollment_id: enrollmentId,
        total_fee_yuan: actualFee,
        status: 'PENDING',
        payment_params: payRes.payment,
        createTime: db.serverDate(),
        paymentExpireTime,
        paymentQueryTime: null,
        created_at: db.serverDate(),
        updated_at: db.serverDate(),
      },
    });

    return { success: true, enrollment_id: enrollmentId, paymentId: addPay._id, payment: payRes.payment };
  } catch (err) {
    await decrementHeld(db, court_rush_id);
    return { success: false, error: 'ENROLL_FAILED', message: err.message };
  }
};
