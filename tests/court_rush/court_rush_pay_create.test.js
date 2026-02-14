const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function loadWithMock(modulePath, cloudMock) {
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloudMock;
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve(modulePath)];
  const loaded = require(modulePath);
  Module._load = originalLoad;
  return loaded;
}

test('court_rush_pay_create creates pending payment with 4-minute expiry', async () => {
  let added = null;
  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'test',
    init: () => {},
    database: () => ({
      serverDate: () => ({ $date: true }),
      collection: (name) => {
        assert.equal(name, 'court_rush_payment');
        return {
          add: async ({ data }) => {
            added = data;
            return { _id: 'pay_1' };
          },
        };
      },
    }),
    cloudPay: {
      unifiedOrder: async () => ({ payment: { timeStamp: '1', nonceStr: 'n' } }),
    },
  };

  const { main } = loadWithMock('d:/project/court-book/cloudfunctions/court_rush_pay_create/index.js', cloudMock);
  const res = await main({
    phoneNumber: '13800000000',
    openid: 'openid_1',
    nonceStr: 'nonce',
    court_rush_id: 'rush_1',
    enrollment_id: 'enroll_1',
    total_fee_yuan: 88,
  });

  assert.equal(res.success, true);
  assert.equal(added.status, 'PENDING');
  assert.ok(added.paymentExpireTime instanceof Date);
  const diffMs = added.paymentExpireTime.getTime() - Date.now();
  assert.ok(diffMs > 3.5 * 60 * 1000 && diffMs <= 4.1 * 60 * 1000);
});
