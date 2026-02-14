const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function generateOutTradeNo(input) {
  const raw = `${input.phoneNumber || ''}${input.court_rush_id || ''}${input.enrollment_id || ''}${Date.now()}${Math.random()}`;
  return crypto.createHash('md5').update(raw).digest('hex').substring(0, 32);
}

function formatTimeExpire(date) {
  const beijingOffset = 8 * 60 * 60 * 1000;
  const beijingTime = new Date(date.getTime() + beijingOffset);
  const pad = (num) => String(num).padStart(2, '0');
  return `${beijingTime.getUTCFullYear()}${pad(beijingTime.getUTCMonth() + 1)}${pad(beijingTime.getUTCDate())}${pad(beijingTime.getUTCHours())}${pad(beijingTime.getUTCMinutes())}${pad(beijingTime.getUTCSeconds())}`;
}

exports.main = async (event) => {
  const {
    phoneNumber,
    openid,
    nonceStr,
    court_rush_id,
    enrollment_id,
    total_fee_yuan,
  } = event || {};

  if (!phoneNumber || !openid || !court_rush_id || !enrollment_id || !total_fee_yuan) {
    return { success: false, error: 'INVALID_PARAMS', message: 'Missing required fields' };
  }

  const db = cloud.database();
  const outTradeNo = generateOutTradeNo(event);
  const now = Date.now();
  const paymentExpireTime = new Date(now + 4 * 60 * 1000);
  const timeExpire = formatTimeExpire(paymentExpireTime);

  const payRes = await cloud.cloudPay.unifiedOrder({
    outTradeNo,
    body: 'court rush payment',
    totalFee: Math.round(Number(total_fee_yuan) * 100),
    subMchId: '1716570749',
    nonceStr: nonceStr || generateOutTradeNo(event).substring(0, 32),
    openid,
    spbillCreateIp: '127.0.0.1',
    envId: 'cloud1-6gebob4m4ba8f3de',
    tradeType: 'JSAPI',
    timeExpire,
    functionName: 'court_rush_order_callback',
  });

  const doc = {
    outTradeNo,
    court_rush_id,
    enrollment_id,
    phoneNumber,
    total_fee_yuan: Number(total_fee_yuan),
    status: 'PENDING',
    payment_parmas: payRes.payment,
    payment_params: payRes.payment,
    createTime: db.serverDate(),
    paymentExpireTime,
    timeExpire,
    paymentQueryTime: null,
    created_at: db.serverDate(),
    updated_at: db.serverDate(),
  };

  const addRes = await db.collection('court_rush_payment').add({ data: doc });
  return {
    success: true,
    paymentId: addRes._id,
    outTradeNo,
    payment: payRes.payment,
    paymentExpireTime,
  };
};
