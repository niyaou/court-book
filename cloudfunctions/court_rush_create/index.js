const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function generateRushId(phoneNumber, courtIds) {
  const baseStr = `${phoneNumber || ''}${(courtIds || []).join(',')}${Date.now()}${Math.random()}`
  return crypto.createHash('md5').update(baseStr).digest('hex').substring(0, 32)
}

function parseCourtId(courtId) {
  if (!courtId || typeof courtId !== 'string') return null
  const parts = courtId.split('_')
  if (parts.length < 3) return null
  const [courtNumber, date, start_time] = parts
  if (!courtNumber || !date || !start_time) return null
  return { court_id: courtId, courtNumber, date, start_time }
}

function buildDateTime(date, time) {
  if (!date || !time) return null
  const y = date.slice(0, 4)
  const m = date.slice(4, 6)
  const d = date.slice(6, 8)
  return new Date(`${y}-${m}-${d}T${time}:00+08:00`)
}

function calcPrice(basePrice, courtInfos) {
  const base = Number(basePrice)
  if (!Number.isFinite(base)) return null
  let countAfter1830 = 0
  const threshold = '18:30'
  for (const info of courtInfos) {
    if (!info.start_time) continue
    if (info.start_time >= threshold) countAfter1830 += 1
  }
  const totalLightFee = countAfter1830 * 10
  const extraPerPerson = totalLightFee / 2
  return Math.ceil(base + extraPerPerson)
}

exports.main = async (event) => {
  const db = cloud.database()
  const _ = db.command

  const { phoneNumber, campus, max_participants, base_price_per_person_yuan, court_ids } = event || {}

  if (!phoneNumber || !campus || !max_participants || !base_price_per_person_yuan || !Array.isArray(court_ids) || court_ids.length === 0) {
    return { success: false, error: 'INVALID_PARAMS', message: '参数缺失或不合法' }
  }

  const managerRes = await db.collection('manager').where({ phoneNumber }).get()
  const manager = managerRes.data && managerRes.data[0]
  if (!manager || (!manager.courtRushManager && !manager.specialManager)) {
    return { success: false, error: 'NO_PERMISSION', message: '无畅打创建权限' }
  }

  const parsedList = []
  for (const id of court_ids) {
    const info = parseCourtId(id)
    if (!info) {
      return { success: false, error: 'INVALID_COURT_ID', message: `非法场地编号: ${id}` }
    }
    parsedList.push(info)
  }

  const uniqueIds = Array.from(new Set(parsedList.map(i => i.court_id)))

  let earliest = null
  let latest = null
  for (const info of parsedList) {
    const dt = buildDateTime(info.date, info.start_time)
    if (!dt) continue
    if (!earliest || dt < earliest) earliest = dt
    if (!latest || dt > latest) latest = dt
  }

  const finalPrice = calcPrice(base_price_per_person_yuan, parsedList)
  if (!Number.isFinite(finalPrice)) {
    return { success: false, error: 'PRICE_CALC_FAILED', message: '价格计算失败' }
  }

  const rushId = generateRushId(phoneNumber, uniqueIds)

  const existRes = await db.collection('court_order_collection').where({
    campus,
    court_id: _.in(uniqueIds)
  }).get()

  const existingMap = new Map()
  for (const doc of existRes.data || []) {
    existingMap.set(doc.court_id, doc)
  }

  const conflictIds = []
  for (const info of parsedList) {
    const exist = existingMap.get(info.court_id)
    if (exist && (exist.status === 'locked' || exist.status === 'booked')) {
      conflictIds.push(info.court_id)
    }
  }
  if (conflictIds.length > 0) {
    return { success: false, error: 'COURT_CONFLICT', message: '存在已锁定或已预订场地', conflictCourtIds: Array.from(new Set(conflictIds)) }
  }

  const now = new Date()
  for (const info of parsedList) {
    const exist = existingMap.get(info.court_id)
    if (exist) {
      await db.collection('court_order_collection').doc(exist._id).update({
        data: {
          status: 'booked',
          booked_by: rushId,
          source_type: 'COURT_RUSH',
          updated_at: now
        }
      })
    } else {
      const dt = buildDateTime(info.date, info.start_time)
      await db.collection('court_order_collection').add({
        data: {
          court_id: info.court_id,
          campus,
          courtNumber: info.courtNumber,
          date: info.date,
          start_time: info.start_time,
          end_time: null,
          status: 'booked',
          price: null,
          booked_by: rushId,
          source_type: 'COURT_RUSH',
          version: 1,
          created_at: now,
          updated_at: now,
          start_at: dt
        }
      })
    }
  }

  const rushDoc = {
    _id: rushId,
    court_ids: uniqueIds,
    campus,
    max_participants,
    current_participants: 0,
    held_participants: 0,
    price_per_person_yuan: finalPrice,
    status: 'OPEN',
    created_by: phoneNumber,
    start_at: earliest || now,
    end_at: latest || now,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  }

  try {
    await db.collection('court_rush').add({ data: rushDoc })
  } catch (e) {
    return { success: false, error: 'CREATE_RUSH_FAILED', message: '创建畅打记录失败', details: e.message }
  }

  return {
    success: true,
    rushId,
    court_ids: uniqueIds,
    price_per_person_yuan: finalPrice
  }
}

