const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 辅助函数：获取日期字符串 YYYY-MM
function getYearMonth(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

// 循环获取集合中所有匹配数据（单次 limit 100）
async function fetchAll(db, collectionName, whereCondition, orderField = '_id') {
  const list = [];
  const limit = 100;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const res = await db.collection(collectionName)
      .where(whereCondition)
      .orderBy(orderField, 'asc')
      .skip(offset)
      .limit(limit)
      .get();

    const data = res.data || [];
    list.push(...data);
    hasMore = data.length === limit;
    offset += limit;

    // 安全上限，防止意外死循环
    if (offset > 20000) {
      console.warn(`[fetchAll] ${collectionName} 达到安全上限，停止获取`);
      break;
    }
  }

  return list;
}

exports.main = async (event) => {
  const db = cloud.database();
  const { phoneNumber } = event;

  // 参数校验
  if (!phoneNumber) {
    return { success: false, message: '缺少 phoneNumber 参数' };
  }

  // 校验管理员权限
  const managerRes = await db.collection('manager').where({ phoneNumber }).limit(1).get();
  if (!managerRes.data || managerRes.data.length === 0) {
    return { success: false, message: '无权访问，仅限管理员' };
  }

  try {
    // 1. 查询所有已支付的定场订单（最近两年，减少数据量）
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);
    const payOrders = await fetchAll(
      db,
      'pay_order',
      {
        status: 'PAIDED',
        paided_at: db.command.gte(twoYearsAgo)
      },
      'paided_at'
    );

    // 2. 查询所有已支付的畅打订单
    const rushPayments = await fetchAll(
      db,
      'court_rush_payment',
      {
        status: 'PAIDED',
        paided_at: db.command.gte(twoYearsAgo)
      },
      'paided_at'
    );

    // 3. 定场订单汇总：按年月+校区
    const bookingMap = new Map(); // key: `${yearMonth}#${campus}`
    for (const order of payOrders) {
      if (!order.paided_at || !order.campus) continue;
      const ym = getYearMonth(order.paided_at);
      const campus = String(order.campus);
      const fee = Number(order.total_fee || 0);
      const key = `${ym}#${campus}`;
      const item = bookingMap.get(key) || { yearMonth: ym, campus, amount: 0 };
      item.amount += fee;
      bookingMap.set(key, item);
    }

    // 4. 畅打订单汇总：先获取 court_rush 的 campus 映射
    const rushIds = [...new Set(rushPayments.map(p => p.court_rush_id).filter(Boolean))];
    const rushCampusMap = new Map();
    // 分批查询 court_rush（in 操作一次最多 100 个）
    const batchSize = 100;
    for (let i = 0; i < rushIds.length; i += batchSize) {
      const batch = rushIds.slice(i, i + batchSize);
      const rushRes = await db.collection('court_rush')
        .where({ _id: db.command.in(batch) })
        .get();
      for (const r of rushRes.data || []) {
        if (r._id && r.campus) {
          rushCampusMap.set(r._id, String(r.campus));
        }
      }
    }

    const rushMap = new Map(); // key: `${yearMonth}#${campus}`
    for (const payment of rushPayments) {
      if (!payment.paided_at || !payment.court_rush_id) continue;
      const ym = getYearMonth(payment.paided_at);
      const campus = rushCampusMap.get(payment.court_rush_id);
      if (!campus) continue;
      const fee = Number(payment.total_fee_yuan || 0);
      const key = `${ym}#${campus}`;
      const item = rushMap.get(key) || { yearMonth: ym, campus, amount: 0 };
      item.amount += fee;
      rushMap.set(key, item);
    }

    // 5. 合并数据
    const allKeys = new Set([...bookingMap.keys(), ...rushMap.keys()]);
    const allYearMonths = new Set();
    const allCampuses = new Set();

    const merged = [];
    for (const key of allKeys) {
      const booking = bookingMap.get(key);
      const rush = rushMap.get(key);
      const yearMonth = booking ? booking.yearMonth : rush.yearMonth;
      const campus = booking ? booking.campus : rush.campus;
      const bookingAmount = booking ? Math.round(booking.amount * 100) / 100 : 0;
      const rushAmount = rush ? Math.round(rush.amount * 100) / 100 : 0;
      const totalAmount = Math.round((bookingAmount + rushAmount) * 100) / 100;

      allYearMonths.add(yearMonth);
      allCampuses.add(campus);

      merged.push({
        yearMonth,
        campus,
        bookingAmount,
        rushAmount,
        totalAmount
      });
    }

    // 按年月倒序，同月内校区正序
    merged.sort((a, b) => {
      if (a.yearMonth !== b.yearMonth) return b.yearMonth.localeCompare(a.yearMonth);
      return a.campus.localeCompare(b.campus);
    });

    // 6. 计算每月合计
    const monthTotals = [];
    const sortedYearMonths = Array.from(allYearMonths).sort().reverse();
    for (const ym of sortedYearMonths) {
      const monthItems = merged.filter(m => m.yearMonth === ym);
      monthTotals.push({
        yearMonth: ym,
        bookingAmount: Math.round(monthItems.reduce((s, m) => s + m.bookingAmount, 0) * 100) / 100,
        rushAmount: Math.round(monthItems.reduce((s, m) => s + m.rushAmount, 0) * 100) / 100,
        totalAmount: Math.round(monthItems.reduce((s, m) => s + m.totalAmount, 0) * 100) / 100
      });
    }

    // 7. 计算总计
    const grandTotal = {
      bookingAmount: Math.round(merged.reduce((s, m) => s + m.bookingAmount, 0) * 100) / 100,
      rushAmount: Math.round(merged.reduce((s, m) => s + m.rushAmount, 0) * 100) / 100,
      totalAmount: Math.round(merged.reduce((s, m) => s + m.totalAmount, 0) * 100) / 100
    };

    return {
      success: true,
      data: merged,
      campuses: Array.from(allCampuses).sort(),
      yearMonths: sortedYearMonths,
      monthTotals,
      grandTotal
    };
  } catch (error) {
    console.error('汇总失败:', error);
    return {
      success: false,
      message: '汇总失败: ' + error.message
    };
  }
};
