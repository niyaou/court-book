const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadHandler(connection) {
  const directory = path.join(__dirname, '../cloudfunctions/recharge_notice')
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(directory, 'index.js'), 'utf8'), {
    exports, console,
    require(name) {
      if (name === 'wx-server-sdk') return { init() {} }
      if (name === './db') return { createConnection: async () => connection }
      return require(path.join(directory, name))
    }
  })
  return exports.main
}

function loadForm(handler) {
  let page
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/rechargeNoticeForm/rechargeNoticeForm.js'), 'utf8'), {
    Page(definition) { page = definition },
    getApp: () => ({ globalData: { coachContext: { coach: { id: 3 } } } }),
    wx: {
      showToast() {},
      cloud: { callFunction({ data, success, fail }) { handler(data).then(result => success({ result }), fail) } }
    },
    setTimeout() {}, console
  })
  page.setData = patch => Object.assign(page.data, patch)
  return page
}

test('form creates without a member, reopens it, and saves edits with SQL NULL', async () => {
  const writes = []
  const handler = loadHandler({
    async execute(sql, params) {
      if (sql.startsWith('INSERT')) { writes.push([...params]); return [{ insertId: 8 }] }
      if (sql.startsWith('SELECT DATE_FORMAT')) return [[{ rechargeDate: '2026-09-30' }]]
      if (sql.startsWith('UPDATE')) { writes.push([...params]); return [{ affectedRows: 1 }] }
      throw new Error(`Unexpected query: ${sql}`)
    },
    async end() {}
  })
  const responses = []
  const page = loadForm(async event => {
    const result = await handler(event)
    responses.push(result)
    return result
  })
  assert.equal(page.validate(), '请填写充值备注')
  page.setData({ note: '  新会员充值  ' })
  await page.submit()
  assert.equal(responses[0].success, true)
  assert.deepEqual(writes[0], [3, null, '新会员充值'])

  page.setData({ mode: 'edit', noticeId: 8 })
  page.hydrate({ memberId: null, note: '补充备注', version: 1 })
  assert.equal(page.data.member, null)
  await page.submit()
  assert.equal(responses[1].success, true)
  assert.deepEqual(writes[1], [null, '补充备注', 8, 3, 1])

  page.hydrate({ memberId: 7, memberName: '会员', note: '清空会员', version: 2 })
  page.clearMember()
  await page.submit()
  assert.equal(responses[2].success, true)
  assert.deepEqual(writes[2], [null, '清空会员', 8, 3, 2])
})

test('selected members still require an existing member on create or reassignment', async () => {
  const handler = loadHandler({
    async execute(sql) {
      if (sql.startsWith('SELECT id FROM prepaid_card')) return [[]]
      if (sql.startsWith('SELECT member_id')) return [[{ member_id: null }]]
      throw new Error(`Unexpected query: ${sql}`)
    },
    async end() {}
  })
  for (const action of ['create', 'update']) {
    const result = await handler({ action, coachId: 3, id: 8, notice: { memberId: 7, note: '充值', version: 1 } })
    assert.equal(result.code, 'VALIDATION_FAILED')
    assert.equal(result.message, '会员不存在或已失效')
  }
})

test('clearing a member still respects record ownership and version conflicts', async () => {
  for (const existing of [[], [{ version: 2 }]]) {
    const handler = loadHandler({
      async execute(sql, params) {
        if (sql.startsWith('UPDATE')) {
          assert.match(sql, /WHERE id = \? AND coach_id = \? AND version = \?/)
          assert.deepEqual([...params], [null, '充值', 8, 3, 1])
          return [{ affectedRows: 0 }]
        }
        if (sql.startsWith('SELECT version')) return [existing]
        throw new Error(`Unexpected query: ${sql}`)
      },
      async end() {}
    })
    const result = await handler({ action: 'update', coachId: 3, id: 8, notice: { memberId: null, note: '充值', version: 1 } })
    assert.equal(result.code, existing.length ? 'RECHARGE_NOTICE_UPDATED' : 'RECHARGE_NOTICE_NOT_FOUND')
  }
})
