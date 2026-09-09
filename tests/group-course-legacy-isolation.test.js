const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// Offline interleaving fixtures: an old ordinary order and a newer group course
// can refer to the same slot. No real SDK, database or payment calls are used.
function database(seed, beforeGet = () => {}) {
  const tables = structuredClone(seed)
  const command = {
    in: values => ({ op: 'in', values }),
    neq: value => ({ op: 'neq', value })
  }
  const matches = (row, where) => Object.entries(where).every(([key, expected]) => {
    if (expected && expected.op === 'in') return expected.values.includes(row[key])
    if (expected && expected.op === 'neq') return row[key] !== expected.value
    return row[key] === expected
  })
  return {
    tables, command, serverDate: () => new Date('2026-09-05T08:00:00Z'),
    collection(name) {
      tables[name] ||= []
      const query = where => ({
        async get() {
          beforeGet(name, where, tables)
          return { data: structuredClone(tables[name].filter(row => matches(row, where))) }
        },
        async update({ data }) {
          let updated = 0
          for (const row of tables[name]) if (matches(row, where)) { Object.assign(row, data); updated++ }
          return { stats: { updated } }
        },
        async remove() {
          const before = tables[name].length
          tables[name] = tables[name].filter(row => !matches(row, where))
          return { stats: { removed: before - tables[name].length } }
        }
      })
      return {
        where: query,
        async add({ data }) {
          for (const row of Array.isArray(data) ? data : [data]) tables[name].push(structuredClone(row))
          return { _id: 'offline-created' }
        },
        doc: id => {
          const q = query({ _id: id })
          return { ...q, async get() { const { data } = await q.get(); return { data: data[0] } } }
        }
      }
    }
  }
}

function loadFunction(name, db, privateNames = []) {
  const file = path.join(__dirname, '..', 'cloudfunctions', name, 'index.js')
  const code = fs.readFileSync(file, 'utf8')
  const module = { exports: {} }
  const sandbox = {
    module, exports: module.exports, console: { log() {}, error() {} }, Date, Set, Map,
    require(name) {
      if (name === 'wx-server-sdk') return { init() {}, database: () => db }
      if (name === 'crypto') return require('node:crypto')
      throw new Error(`Unexpected runtime dependency: ${name}`)
    }
  }
  vm.runInNewContext(`${code}\nexports.privateFunctions = {${privateNames.join(',')}}`, sandbox, { filename: file })
  return module.exports
}

function fixture() {
  const slot = '1_20260906_19:00'
  const ordinarySlot = '1_20260906_19:30'
  const phone = 'test-admin'
  return database({
    manager: [{ phoneNumber: phone }],
    pay_order: [{ _id: 'old-order', outTradeNo: 'old-payment', campus: 'campus-a', phoneNumber: phone, court_ids: [slot, ordinarySlot], status: 'PENDING' }],
    court_order_collection: [
      { _id: 'group-slot', court_id: slot, campus: 'campus-a', status: 'booked', source_type: 'GROUP_COURSE', group_course_id: 'group-a', version: 8 },
      // Missing source_type is intentional: historical ordinary orders must continue working.
      { _id: 'ordinary-slot', court_id: ordinarySlot, campus: 'campus-a', status: 'locked', booked_by: phone, version: 2 }
    ]
  })
}

test('late ordinary refund callback leaves group slot intact and still releases an ordinary slot', async () => {
  const db = fixture()
  const before = structuredClone(db.tables.court_order_collection[0])
  const fn = loadFunction('order_refund_callback', db)
  await fn.main({ outTradeNo: 'old-payment' })
  await fn.main({ outTradeNo: 'old-payment' })
  assert.deepEqual(db.tables.court_order_collection, [before])
  assert.equal(db.tables.pay_order[0].status, 'REFUNDED')
})

test('repeated ordinary administrator cancellation cannot release a newer group course', async () => {
  const db = fixture()
  const fn = loadFunction('cancel_order', db)
  const input = { order: { _id: 'old-order' }, operatorPhoneNumber: 'test-admin', cancelReason: 'test cancellation' }
  assert.equal((await fn.main(input)).success, true)
  assert.equal((await fn.main(input)).success, true)
  assert.equal(db.tables.court_order_collection.length, 1)
  assert.equal(db.tables.court_order_collection[0].group_course_id, 'group-a')
})

test('ordinary payment callback updates historical ordinary records but excludes group records', async () => {
  const db = fixture()
  // A distinctive status proves the old callback did not touch the group record.
  db.tables.court_order_collection[0].status = 'group-sentinel'
  await loadFunction('order_create_callback', db).main({ outTradeNo: 'old-payment' })
  assert.equal(db.tables.court_order_collection[0].status, 'group-sentinel')
  assert.equal(db.tables.court_order_collection[1].status, 'booked')
})

test('ordinary rollback does not overwrite a newer version or group ownership', async () => {
  const db = fixture()
  const { rollbackUpdates } = loadFunction('update_court_order', db, ['rollbackUpdates']).privateFunctions
  const op = { court_id: '1_20260906_19:00', campus: 'campus-a', data: { version: 2 }, originalOrder: { campus: 'campus-a', status: 'free', version: 1 } }
  const ordinaryOp = { ...op, court_id: '1_20260906_19:30' }
  await rollbackUpdates([op, ordinaryOp], db)
  assert.equal(db.tables.court_order_collection[0].version, 8)
  assert.equal(db.tables.court_order_collection[0].status, 'booked')
  assert.equal(db.tables.court_order_collection[1].status, 'free')
  db.tables.court_order_collection[1].version = 4
  db.tables.court_order_collection[1].status = 'booked'
  await rollbackUpdates([op, ordinaryOp], db)
  assert.equal(db.tables.court_order_collection[1].version, 4)
  assert.equal(db.tables.court_order_collection[1].status, 'booked')
})

test('ordinary inserted-slot rollback removes only its original version and owner', async () => {
  const db = fixture()
  const { rollbackAdds } = loadFunction('update_court_order', db, ['rollbackAdds']).privateFunctions
  await rollbackAdds(['1_20260906_19:00', '1_20260906_19:30'].map(court_id => ({ court_id, campus: 'campus-a', data: { version: 2, booked_by: 'test-admin' } })), db)
  assert.equal(db.tables.court_order_collection.length, 1)
  assert.equal(db.tables.court_order_collection[0].group_course_id, 'group-a')
})

for (const admin of [false, true]) {
  test(`group publication between ordinary precheck and insert cannot enter payment (admin=${admin})`, async () => {
    let reads = 0
    const slot = '1_20260906_19:00'
    const db = database({
      manager: admin ? [{ phoneNumber: 'ordinary-booker' }] : [],
      court_order_collection: [], pay_order: []
    }, (name, where, tables) => {
      if (name === 'court_order_collection' && ++reads === 2) {
        tables[name].push({ court_id: slot, campus: 'campus-a', source_type: 'GROUP_COURSE', group_course_id: 'published-during-booking', status: 'booked', version: 1 })
      }
    })
    const fn = loadFunction('update_court_order', db)
    const result = await fn.main({ data: [{ court_id: slot, campus: 'campus-a', courtNumber: '1', date: '20260906', start_time: '19:00', end_time: '19:30', booked_by: 'ordinary-booker', status: 'locked', price: 40 }] })
    assert.equal(result.success, false)
    assert.equal(result.results.length, 1)
    assert.equal(result.results.every(row => row.success), false)
    assert.equal(db.tables.pay_order.length, 0)
    assert.equal(db.tables.court_order_collection.length, 1)
    assert.equal(db.tables.court_order_collection[0].group_course_id, 'published-during-booking')
  })
}

test('ordinary uncontested insertion still succeeds after conflict propagation', async () => {
  const db = database({ manager: [], court_order_collection: [], pay_order: [] })
  const fn = loadFunction('update_court_order', db)
  const result = await fn.main({ data: [{ court_id: '1_20260906_19:00', campus: 'campus-a', courtNumber: '1', date: '20260906', start_time: '19:00', end_time: '19:30', booked_by: 'ordinary-booker', status: 'locked', price: 40 }] })
  assert.equal(result.success, true)
  assert.equal(result.results.length, 1)
  assert.equal(result.results[0].success, true)
  assert.equal(db.tables.court_order_collection[0].status, 'locked')
})
