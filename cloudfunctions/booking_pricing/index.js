const cloud = require('wx-server-sdk');
const {
  calculatePricing,
  normalizeLightingRule,
  selectEffectiveRule,
  validateDate,
  validateTime,
} = require('./pricing');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const MAX_SLOTS = 100;

function validateInput(event) {
  const campus = String((event && event.campus) || '').trim();
  const slots = event && event.slots;
  if (!campus || !Array.isArray(slots) || slots.length === 0 || slots.length > MAX_SLOTS) {
    return null;
  }

  const normalizedSlots = slots.map((slot) => ({
    date: String((slot && slot.date) || ''),
    start_time: String((slot && slot.start_time) || ''),
  }));
  if (normalizedSlots.some((slot) => !validateDate(slot.date) || !validateTime(slot.start_time))) {
    return null;
  }
  return { campus, slots: normalizedSlots };
}

async function loadRuleForDate(db, date, campus) {
  const _ = db.command;
  const result = await db.collection('booking_pricing_rules').where({
    type: 'BOOKING_PRICING',
    status: 'PUBLISHED',
    effective_from: _.lte(date),
  }).orderBy('effective_from', 'desc').limit(1).get();

  const row = selectEffectiveRule(result.data || [], date);
  return normalizeLightingRule(row, campus);
}

exports.main = async (event) => {
  const input = validateInput(event);
  if (!input) {
    return { success: false, error: 'INVALID_PRICING_INPUT', message: '计费参数格式错误' };
  }

  try {
    const db = cloud.database();
    const uniqueDates = [...new Set(input.slots.map((slot) => slot.date))];
    const resolvedRules = await Promise.all(uniqueDates.map(async (date) => [
      date,
      await loadRuleForDate(db, date, input.campus),
    ]));
    const rulesByDate = Object.fromEntries(resolvedRules);
    const pricing = calculatePricing(input.slots, rulesByDate);
    const rules = uniqueDates.map((date) => rulesByDate[date]);

    return {
      success: true,
      data: {
        ...pricing,
        rules,
      },
    };
  } catch (error) {
    console.error('[booking_pricing] pricing failed', error);
    return {
      success: false,
      error: error.code || 'PRICING_CONFIG_ERROR',
      message: '灯光费配置异常，请联系管理员',
    };
  }
};

exports._test = { validateInput };
