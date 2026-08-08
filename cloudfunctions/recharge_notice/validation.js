const STATUSES = new Set(['PENDING', 'ACKNOWLEDGED'])

function positiveInteger(value) {
  const normalized = Number(value)
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null
}

function normalizeNote(value) {
  return String(value === undefined || value === null ? '' : value).trim()
}

function validateWrite(input, requireVersion = false) {
  const value = input || {}
  const memberId = positiveInteger(value.memberId)
  const note = normalizeNote(value.note)
  const version = positiveInteger(value.version)
  if (!memberId) return { error: '会员无效' }
  if (!note) return { error: '请填写充值备注' }
  if (note.length > 500) return { error: '充值备注不能超过 500 个字符' }
  if (requireVersion && !version) return { error: '记录版本无效' }
  return { value: { memberId, note, version } }
}

function normalizeStatus(value) {
  const status = String(value || 'PENDING').toUpperCase()
  return STATUSES.has(status) ? status : null
}

function normalizePage(value) {
  const page = Number.parseInt(value, 10)
  return Number.isInteger(page) && page > 0 ? page : 1
}

module.exports = { normalizeNote, normalizePage, normalizeStatus, positiveInteger, validateWrite }
