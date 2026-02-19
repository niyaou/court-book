const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function isAdminManager(manager) {
  if (!manager || typeof manager !== 'object') return false;
  const courtRushManager = Number(manager.courtRushManager || 0);
  const specialManager = Number(manager.specialManager || 0);
  return courtRushManager >= 1 || specialManager >= 1;
}

function generateRushId(phoneNumber, courtIds) {
  const base = `${phoneNumber || ''}${(courtIds || []).join(',')}${Date.now()}${Math.random()}`;
  return crypto.createHash('md5').update(base).digest('hex').substring(0, 32);
}

function addMinutes(time, minutes) {
  if (!time || typeof time !== 'string') return null;
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const total = h * 60 + m + minutes;
  const hour = Math.floor(total / 60).toString().padStart(2, '0');
  const minute = (total % 60).toString().padStart(2, '0');
  return `${hour}:${minute}`;
}

function parseCourtId(courtId) {
  const parts = String(courtId || '').split('_');
  if (parts.length < 3) return null;
  return {
    court_id: courtId,
    courtNumber: parts[0],
    date: parts[1],
    start_time: parts[2],
    end_time: addMinutes(parts[2], 30),
  };
}

function buildDateTime(date, time) {
  if (!date || !time) return null;
  const y = date.slice(0, 4);
  const m = date.slice(4, 6);
  const d = date.slice(6, 8);
  return new Date(`${y}-${m}-${d}T${time}:00+08:00`);
}

function ensureContinuousSameCourt(courtInfos) {
  if (!courtInfos.length) return false;
  const courtNumber = courtInfos[0].courtNumber;
  if (courtInfos.some((c) => c.courtNumber !== courtNumber)) return false;

  const sorted = [...courtInfos].sort((a, b) => a.start_time.localeCompare(b.start_time));
  for (let i = 1; i < sorted.length; i += 1) {
    const [ph, pm] = sorted[i - 1].start_time.split(':').map(Number);
    const [ch, cm] = sorted[i].start_time.split(':').map(Number);
    const prevMinutes = ph * 60 + pm;
    const curMinutes = ch * 60 + cm;
    if (curMinutes - prevMinutes !== 30) return false;
  }
  return true;
}

exports.main = async (event) => {
  const db = cloud.database();
  const _ = db.command;

  const {
    phoneNumber,
    campus,
    court_ids = [],
    max_participants,
    price_per_person_yuan,
    venue_total_fee_yuan,
  } = event || {};

  if (!phoneNumber || !campus || !Array.isArray(court_ids) || !court_ids.length || !max_participants || !price_per_person_yuan) {
    return { success: false, error: 'INVALID_PARAMS', message: 'Missing required fields' };
  }

  const managerRes = await db.collection('manager').where({ phoneNumber }).limit(1).get();
  const manager = (managerRes.data || [])[0];
  if (!isAdminManager(manager)) {
    return { success: false, error: 'NO_PERMISSION', message: 'No permission' };
  }

  const parsedList = court_ids.map(parseCourtId).filter(Boolean);
  if (parsedList.length !== court_ids.length) {
    return { success: false, error: 'INVALID_COURT_ID', message: 'Invalid court id format' };
  }

  if (!ensureContinuousSameCourt(parsedList)) {
    return { success: false, error: 'NOT_CONTINUOUS', message: 'Court slots must be same court and continuous' };
  }

  const uniqueCourtIds = Array.from(new Set(court_ids));
  const rushId = generateRushId(phoneNumber, uniqueCourtIds);
  const now = new Date();

  const existingRes = await db.collection('court_order_collection').where({
    campus,
    court_id: _.in(uniqueCourtIds),
  }).get();

  const existingMap = new Map((existingRes.data || []).map((row) => [row.court_id, row]));
  const conflictIds = [];
  uniqueCourtIds.forEach((id) => {
    const row = existingMap.get(id);
    if (row && (row.status === 'locked' || row.status === 'booked')) {
      conflictIds.push(id);
    }
  });

  if (conflictIds.length) {
    return { success: false, error: 'COURT_CONFLICT', conflictCourtIds: conflictIds };
  }

  for (const info of parsedList) {
    const existing = existingMap.get(info.court_id);
    if (existing && existing.status === 'free') {
      await db.collection('court_order_collection').doc(existing._id).update({
        data: {
          end_time: info.end_time,
          status: 'booked',
          booked_by: phoneNumber,
          rush_id: rushId,
          is_verified: false,
          source_type: 'COURT_RUSH',
          updated_at: now,
        },
      });
      continue;
    }

    if (!existing) {
      await db.collection('court_order_collection').add({
        data: {
          court_id: info.court_id,
          campus,
          courtNumber: info.courtNumber,
          date: info.date,
          start_time: info.start_time,
          end_time: info.end_time,
          status: 'booked',
          booked_by: phoneNumber,
          rush_id: rushId,
          is_verified: false,
          source_type: 'COURT_RUSH',
          version: 1,
          created_at: now,
          updated_at: now,
          price: null,
        },
      });
    }
  }

  const sortedTimes = [...parsedList].sort((a, b) => a.start_time.localeCompare(b.start_time));
  const startAt = buildDateTime(sortedTimes[0].date, sortedTimes[0].start_time) || now;
  const lastSlot = sortedTimes[sortedTimes.length - 1];
  const endAt = buildDateTime(lastSlot.date, lastSlot.end_time || lastSlot.start_time) || now;

  const rushDoc = {
    _id: rushId,
    court_ids: uniqueCourtIds,
    campus,
    max_participants: Number(max_participants),
    current_participants: 0,
    held_participants: 0,
    price_per_person_yuan: Number(price_per_person_yuan),
    venue_total_fee_yuan: Number(venue_total_fee_yuan || 0),
    total_revenue_yuan: 0,
    status: 'OPEN',
    created_by: phoneNumber,
    start_at: startAt,
    end_at: endAt,
    cancel_refund_status: 'NOT_STARTED',
    cancelled_at: null,
    created_at: db.serverDate(),
    updated_at: db.serverDate(),
  };

  await db.collection('court_rush').add({ data: rushDoc });

  return {
    success: true,
    rushId,
    court_ids: uniqueCourtIds,
  };
};
