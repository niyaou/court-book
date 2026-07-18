const DATE_PATTERN = /^\d{8}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):(?:00|30)$/;

function roundYuan(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function formatYuan(value) {
  const rounded = roundYuan(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function validateDate(date) {
  const value = String(date || '');
  if (!DATE_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function validateTime(time) {
  return TIME_PATTERN.test(String(time || ''));
}

function selectEffectiveRule(rows, date) {
  if (!validateDate(date)) {
    const error = new Error(`Invalid booking date: ${date}`);
    error.code = 'INVALID_PRICING_INPUT';
    throw error;
  }

  const candidates = (rows || [])
    .filter((row) => row && row.type === 'BOOKING_PRICING' && row.status === 'PUBLISHED')
    .filter((row) => validateDate(row.effective_from) && row.effective_from <= date)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));

  if (!candidates.length) {
    const error = new Error(`No published pricing rule applies to ${date}`);
    error.code = 'PRICING_CONFIG_NOT_FOUND';
    throw error;
  }
  return candidates[0];
}

function normalizeLightingRule(row, campus) {
  if (Number(row && row.schema_version) !== 1) {
    const error = new Error(`Unsupported pricing schema version: ${row && row.schema_version}`);
    error.code = 'INVALID_PRICING_CONFIG';
    throw error;
  }
  const base = row && row.lighting_fee;
  if (!base || typeof base !== 'object') {
    const error = new Error('Missing lighting_fee configuration');
    error.code = 'INVALID_PRICING_CONFIG';
    throw error;
  }

  const overrides = Array.isArray(row.campus_overrides) ? row.campus_overrides : [];
  const matchingOverrides = overrides.filter((item) => item && item.campus === campus);
  if (matchingOverrides.length > 1) {
    const error = new Error(`Duplicate campus override: ${campus}`);
    error.code = 'INVALID_PRICING_CONFIG';
    throw error;
  }

  if (matchingOverrides.length === 1
    && (!matchingOverrides[0].lighting_fee || typeof matchingOverrides[0].lighting_fee !== 'object')) {
    const error = new Error(`Invalid campus override: ${campus}`);
    error.code = 'INVALID_PRICING_CONFIG';
    throw error;
  }
  const override = matchingOverrides[0] && matchingOverrides[0].lighting_fee;
  const merged = { ...base, ...(override || {}) };
  if (typeof merged.enabled !== 'boolean') {
    const error = new Error('lighting_fee.enabled must be boolean');
    error.code = 'INVALID_PRICING_CONFIG';
    throw error;
  }

  if (!merged.enabled) {
    return {
      rule_id: row._id,
      effective_from: row.effective_from,
      enabled: false,
      start_time: null,
      fee_per_slot_yuan: 0,
      notice: '当前预约日期不收取灯光费',
    };
  }

  if (!validateTime(merged.start_time)) {
    const error = new Error(`Invalid lighting start_time: ${merged.start_time}`);
    error.code = 'INVALID_PRICING_CONFIG';
    throw error;
  }

  const fee = merged.fee_per_slot_yuan;
  if (typeof fee !== 'number' || !Number.isFinite(fee) || fee < 0 || roundYuan(fee) !== fee) {
    const error = new Error(`Invalid lighting fee: ${merged.fee_per_slot_yuan}`);
    error.code = 'INVALID_PRICING_CONFIG';
    throw error;
  }

  return {
    rule_id: row._id,
    effective_from: row.effective_from,
    enabled: true,
    start_time: merged.start_time,
    fee_per_slot_yuan: fee,
    notice: `${merged.start_time}起每半小时加收${formatYuan(fee)}元灯光费`,
  };
}

function calculateSlotFee(startTime, rule) {
  if (!validateTime(startTime)) {
    const error = new Error(`Invalid slot start_time: ${startTime}`);
    error.code = 'INVALID_PRICING_INPUT';
    throw error;
  }
  if (!rule.enabled || startTime < rule.start_time) return 0;
  return rule.fee_per_slot_yuan;
}

function calculatePricing(slots, rulesByDate) {
  const pricedSlots = (slots || []).map((slot) => {
    const rule = rulesByDate[slot.date];
    if (!rule) {
      const error = new Error(`Missing resolved rule for ${slot.date}`);
      error.code = 'PRICING_CONFIG_NOT_FOUND';
      throw error;
    }
    return {
      date: slot.date,
      start_time: slot.start_time,
      lighting_fee_yuan: calculateSlotFee(slot.start_time, rule),
      rule_id: rule.rule_id,
    };
  });

  return {
    slots: pricedSlots,
    total_lighting_fee_yuan: roundYuan(pricedSlots.reduce((sum, slot) => sum + slot.lighting_fee_yuan, 0)),
  };
}

module.exports = {
  calculatePricing,
  calculateSlotFee,
  normalizeLightingRule,
  roundYuan,
  selectEffectiveRule,
  validateDate,
  validateTime,
};
