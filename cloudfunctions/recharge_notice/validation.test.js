const assert = require('assert')
const { normalizePage, normalizeStatus, positiveInteger, validateWrite } = require('./validation')

assert.strictEqual(positiveInteger('3'), 3)
assert.strictEqual(positiveInteger(0), null)
assert.strictEqual(normalizeStatus(), 'PENDING')
assert.strictEqual(normalizeStatus('acknowledged'), 'ACKNOWLEDGED')
assert.strictEqual(normalizeStatus('DONE'), null)
assert.strictEqual(normalizePage('2'), 2)
assert.strictEqual(normalizePage('-1'), 1)

assert.deepStrictEqual(validateWrite({ memberId: '7', note: '  已微信充值  ', version: '2' }, true), {
  value: { memberId: 7, note: '已微信充值', version: 2 }
})
for (const memberId of [undefined, null, '']) {
  assert.deepStrictEqual(validateWrite({ memberId, note: '  充值  ' }), {
    value: { memberId: null, note: '充值', version: null }
  })
  assert.deepStrictEqual(validateWrite({ memberId, note: '充值', version: 2 }, true), {
    value: { memberId: null, note: '充值', version: 2 }
  })
}
for (const memberId of [0, -1, 1.5, 'invalid', ' ']) {
  assert.strictEqual(validateWrite({ memberId, note: '充值' }).error, '会员无效')
}
assert.strictEqual(validateWrite({ note: '   ' }).error, '请填写充值备注')
assert.strictEqual(validateWrite({ note: '充值' }, true).error, '记录版本无效')
assert.strictEqual(validateWrite({ memberId: 7, note: '   ' }).error, '请填写充值备注')
assert.strictEqual(validateWrite({ memberId: 7, note: 'a'.repeat(501) }).error, '充值备注不能超过 500 个字符')
assert.strictEqual(validateWrite({ memberId: 7, note: '充值', version: 0 }, true).error, '记录版本无效')

console.log('recharge_notice validation tests passed')
