const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// Run the real entry point with an offline database, clock and payment service.
const START = Date.parse('2026-09-24T06:00:00Z')
const CAMPUS = '麓坊校区'
const PHONE = 'offline-customer'

function fixture(count = 7) {
  const input = {
    campus: CAMPUS, phoneNumber: PHONE, nonceStr: 'offline-nonce',
    court_ids: Array.from({ length: count }, (_, i) => `1号风雨棚_20260925_${String(7 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)
  }
  const tables = {
    manager: [], pay_order: [],
    court_order_collection: input.court_ids.map((id, i) => ({
      _id: `lock-${String(i).padStart(3, '0')}`, court_id: id, campus: CAMPUS,
      booked_by: PHONE, status: 'locked', updated_at: new Date(START), version: 1
    }))
  }
  const state = { now: START, paymentCalls: [], reads: [], afterPricing() {}, beforeLockRead() {} }
  const command = {
    in: values => ({ op: 'in', values }),
    gte: value => ({ op: 'gte', value })
  }
  const matches = (row, where) => Object.entries(where).every(([key, expected]) => {
    if (expected && expected.op === 'in') {
      return Array.isArray(row[key])
        ? row[key].some(value => expected.values.includes(value))
        : expected.values.includes(row[key])
    }
    if (expected && expected.op === 'gte') return row[key] >= expected.value
    return row[key] === expected
  })
  const db = {
    command, serverDate: () => new Date(state.now),
    collection(name) {
      const query = (where, offset = 0, limit = 100, ordered = false) => ({
        orderBy(key, direction) {
          assert.equal(key, '_id')
          assert.equal(direction, 'asc')
          return query(where, offset, limit, true)
        },
        skip(value) { return query(where, value, limit, ordered) },
        limit(value) { return query(where, offset, value, ordered) },
        async get() {
          if (name === 'court_order_collection') {
            state.reads.push({ where, offset, limit })
            state.beforeLockRead()
          }
          let rows = tables[name].filter(row => matches(row, where))
          if (ordered) rows = [...rows].sort((a, b) => a._id.localeCompare(b._id))
          return { data: structuredClone(rows.slice(offset, offset + limit)) }
        }
      })
      return {
        where: where => query(where),
        async add({ data }) {
          assert.equal(name, 'pay_order', 'lock checks must never write or renew locks')
          tables[name].push(structuredClone(data))
          return { _id: 'offline-payment' }
        }
      }
    }
  }
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [state.now])) }
    static now() { return state.now }
    static [Symbol.hasInstance](value) { return value instanceof Date }
  }
  const cloud = {
    init() {}, database: () => db,
    cloudPay: {
      async unifiedOrder(data) {
        state.paymentCalls.push(data)
        return { payment: { package: 'offline-payment-parameters' } }
      }
    },
    async callFunction({ name, data }) {
      if (name === 'club_member') return { result: { success: true, data: { rest_charge: 1 } } }
      assert.equal(name, 'booking_pricing')
      await state.afterPricing()
      return { result: { success: true, data: {
        slots: data.slots.map(slot => ({ ...slot, lighting_fee_yuan: 10 })),
        total_lighting_fee_yuan: data.slots.length * 10,
        rules: [{ rule_id: 'offline-lighting' }]
      } } }
    }
  }
  const module = { exports: {} }
  const filename = path.join(__dirname, '../cloudfunctions/pay_order_create/index.js')
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Date: Clock,
    console: { log() {}, error() {} },
    require: name => name === 'wx-server-sdk' ? cloud : require(name)
  }, { filename })
  return { input, tables, state, run: () => module.exports.main(input) }
}

async function rejectsWithoutPayment(f, error) {
  const result = await f.run()
  assert.equal(result.success, false)
  assert.equal(result.error, error)
  assert.equal(typeof result.message, 'string')
  assert.equal(f.state.paymentCalls.length, 0)
  assert.equal(f.tables.pay_order.length, 0)
}

test('valid locks retain VIP pricing, lighting fees and a consistent two-minute expiry', async () => {
  const f = fixture()
  const originalLocks = structuredClone(f.tables.court_order_collection)
  f.state.afterPricing = () => { f.state.now += 1000 }
  const result = await f.run()
  assert.ok(result.payment)
  assert.equal(f.state.paymentCalls.length, 1)
  assert.equal(f.tables.pay_order.length, 1)
  const order = f.tables.pay_order[0]
  assert.equal(order.total_fee, 495)
  assert.equal(order.lighting_fee_yuan, 70)
  assert.equal(order.is_vip, true)
  assert.equal(order.paymentExpireTime.getTime(), START + 121000)
  assert.equal(order.timeExpire, '20260924140201')
  assert.equal(f.state.paymentCalls[0].timeExpire, order.timeExpire)
  assert.equal(f.state.paymentCalls[0].totalFee, 49500)
  assert.deepEqual(f.tables.court_order_collection, originalLocks)
})

for (const [name, change, error] of [
  ['ten-minute old locks still in database', f => { f.state.now += 600000 }, 'BOOKING_LOCK_EXPIRED'],
  ['all locks released', f => { f.tables.court_order_collection = [] }, 'BOOKING_LOCK_MISSING'],
  ['one of seven locks released', f => { f.tables.court_order_collection.pop() }, 'BOOKING_LOCK_MISSING'],
  ['one lock taken by another user', f => { f.tables.court_order_collection[0].booked_by = 'other-customer' }, 'BOOKING_LOCK_CONFLICT'],
  ['one lock already booked', f => { f.tables.court_order_collection[0].status = 'booked' }, 'BOOKING_LOCK_CONFLICT'],
  ['lock exists only in another campus', f => { f.tables.court_order_collection[0].campus = '雅居乐校区' }, 'BOOKING_LOCK_MISSING'],
  ['group course lock', f => { f.tables.court_order_collection[0].source_type = 'GROUP_COURSE' }, 'BOOKING_LOCK_CONFLICT'],
  ['court rush lock', f => { f.tables.court_order_collection[0].source_type = 'COURT_RUSH' }, 'BOOKING_LOCK_CONFLICT'],
  ['duplicate lock records', f => { f.tables.court_order_collection.push({ ...f.tables.court_order_collection[0], _id: 'duplicate' }) }, 'BOOKING_LOCK_DATA_ERROR'],
  ['duplicate requested slots', f => { f.input.court_ids.push(f.input.court_ids[0]) }, 'INVALID_COURT_IDS'],
  ['missing phone', f => { delete f.input.phoneNumber }, 'INVALID_BOOKING_INPUT'],
  ['missing campus', f => { delete f.input.campus }, 'INVALID_BOOKING_INPUT'],
  ['invalid timestamp', f => { f.tables.court_order_collection[0].updated_at = 'invalid' }, 'BOOKING_LOCK_DATA_ERROR'],
  ['null timestamp', f => { f.tables.court_order_collection[0].updated_at = null }, 'BOOKING_LOCK_DATA_ERROR'],
  ['future timestamp', f => { f.tables.court_order_collection[0].updated_at = new Date(START + 1000) }, 'BOOKING_LOCK_DATA_ERROR'],
  ['exact payment-window boundary', f => { f.state.now += 170000 }, 'BOOKING_LOCK_EXPIRED'],
  ['earliest lock controls the entire order', f => { f.tables.court_order_collection[0].updated_at = new Date(START - 180000) }, 'BOOKING_LOCK_EXPIRED'],
  ['database read failure', f => { f.state.beforeLockRead = () => { throw new Error('offline read failure') } }, 'BOOKING_LOCK_CHECK_FAILED']
]) {
  test(name + ' refuses the whole payment', async () => {
    const f = fixture()
    change(f)
    await rejectsWithoutPayment(f, error)
  })
}

for (const [name, change, error] of [
  ['pricing consumes the payment window', f => { f.state.now += 170000 }, 'BOOKING_LOCK_EXPIRED'],
  ['lock disappears while pricing', f => { f.tables.court_order_collection.pop() }, 'BOOKING_LOCK_MISSING'],
  ['owner changes while pricing', f => { f.tables.court_order_collection[0].booked_by = 'other-customer' }, 'BOOKING_LOCK_CONFLICT'],
  ['lock recreated by the same user', f => { f.tables.court_order_collection[0]._id = 'replacement' }, 'BOOKING_LOCK_CONFLICT'],
  ['lock version changes', f => { f.tables.court_order_collection[0].version++ }, 'BOOKING_LOCK_CONFLICT'],
  ['same-user lock timestamp changes', f => { f.state.now++; f.tables.court_order_collection[0].updated_at = new Date(f.state.now) }, 'BOOKING_LOCK_CONFLICT']
]) {
  test(name + ' is caught by the final check', async () => {
    const f = fixture()
    f.state.afterPricing = () => change(f)
    await rejectsWithoutPayment(f, error)
  })
}

test('a window one millisecond longer than the required margin is accepted', async () => {
  const f = fixture()
  f.state.now += 169999
  assert.ok((await f.run()).payment)
})

test('reads all requested slots across batches without mixing campuses', async () => {
  const f = fixture(24)
  f.tables.court_order_collection.push({ ...f.tables.court_order_collection[0], _id: 'another-campus', campus: '雅居乐校区', status: 'booked' })
  assert.ok((await f.run()).payment)
  assert.equal(f.state.reads.length, 4)
  assert.equal(f.tables.pay_order[0].court_ids.length, 24)
})

test('paginates duplicate records and rejects corrupt slot data', async () => {
  const f = fixture(1)
  const record = f.tables.court_order_collection[0]
  f.tables.court_order_collection = Array.from({ length: 101 }, (_, i) => ({ ...record, _id: `duplicate-${i}` }))
  await rejectsWithoutPayment(f, 'BOOKING_LOCK_DATA_ERROR')
  assert.deepEqual(f.state.reads.map(read => read.offset), [0, 100])
})

test('existing administrator and duplicate-order branches remain intact', async () => {
  const admin = fixture()
  admin.tables.manager.push({ phoneNumber: PHONE })
  await rejectsWithoutPayment(admin, 'ADMIN_ORDER_ALREADY_CREATED')
  const duplicate = fixture()
  duplicate.tables.pay_order.push({ status: 'PENDING', campus: CAMPUS, court_ids: duplicate.input.court_ids, createTime: new Date(START) })
  const result = await duplicate.run()
  assert.equal(result.error, 'DUPLICATE_ORDER')
  assert.equal(duplicate.state.paymentCalls.length, 0)
  assert.equal(duplicate.tables.pay_order.length, 1)
})
