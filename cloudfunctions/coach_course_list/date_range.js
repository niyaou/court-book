const BUSINESS_TIME_ZONE = 'Asia/Shanghai'

function businessYearMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return { year: Number(values.year), month: Number(values.month) }
}

function shiftMonth(year, month, offset) {
  const totalMonths = year * 12 + (month - 1) + offset
  return {
    year: Math.floor(totalMonths / 12),
    month: (totalMonths % 12) + 1
  }
}

function monthStart({ year, month }) {
  return `${year}-${String(month).padStart(2, '0')}-01 00:00:00`
}

function rangeForCurrentThreeMonths(now = new Date()) {
  const current = businessYearMonth(now)
  return {
    start: monthStart(shiftMonth(current.year, current.month, -2)),
    end: monthStart(shiftMonth(current.year, current.month, 1))
  }
}

module.exports = { BUSINESS_TIME_ZONE, businessYearMonth, rangeForCurrentThreeMonths }
