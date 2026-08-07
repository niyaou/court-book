const assert = require('assert')
const { mapNotice } = require('./dto')

const dto = mapNotice({
  id: '8', coachId: '3', coachName: '李教练', coachActive: 1,
  memberId: '9', memberName: '王会员', memberNumber: 'M009', memberActive: 0,
  rechargeDate: '2026-08-07', note: '线下充值', status: 'ACKNOWLEDGED', version: '2',
  createdAt: '2026-08-07 09:00:00', updatedAt: '2026-08-07 10:00:00', acknowledgedAt: null
})

assert.deepStrictEqual(Object.keys(dto), [
  'id', 'coachId', 'coachName', 'coachActive', 'memberId', 'memberName', 'memberNumber', 'memberActive',
  'rechargeDate', 'note', 'status', 'version', 'createdAt', 'updatedAt', 'acknowledgedAt'
])
assert.strictEqual(dto.id, 8)
assert.strictEqual(dto.coachActive, true)
assert.strictEqual(dto.memberActive, false)
assert.strictEqual(dto.acknowledgedAt, null)

console.log('recharge_notice DTO tests passed')
