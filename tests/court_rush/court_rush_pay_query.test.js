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

test('court_rush_pay_query returns payable pending order', async () => {
  let updated = false;
  const order = {
    _id: 'pay_1',
    status: 'PENDING',
    createTime: new Date(),
    paymentExpireTime: new Date(Date.now() + 2 * 60 * 1000),
    payment_parmas: { nonceStr: 'n' },
    court_rush_id: 'rush_1',
    total_fee_yuan: 88,
  };

  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'test',
    init: () => {},
    database: () => ({
      serverDate: () => ({ $date: true }),
      collection: () => ({
        doc: () => ({
          get: async () => ({ data: order }),
          update: async () => { updated = true; return { stats: { updated: 1 } }; },
        }),
      }),
    }),
  };

  const { main } = loadWithMock('d:/project/court-book/cloudfunctions/court_rush_pay_query/index.js', cloudMock);
  const res = await main({ paymentId: 'pay_1' });

  assert.equal(res.success, true);
  assert.equal(updated, true);
});

test('court_rush_pay_query rejects expired payment order', async () => {
  const order = {
    _id: 'pay_1',
    status: 'PENDING',
    createTime: new Date(Date.now() - 6 * 60 * 1000),
    paymentExpireTime: new Date(Date.now() - 60 * 1000),
  };

  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'test',
    init: () => {},
    database: () => ({
      serverDate: () => ({ $date: true }),
      collection: () => ({
        doc: () => ({
          get: async () => ({ data: order }),
          update: async () => ({ stats: { updated: 1 } }),
        }),
      }),
    }),
  };

  const { main } = loadWithMock('d:/project/court-book/cloudfunctions/court_rush_pay_query/index.js', cloudMock);
  const res = await main({ paymentId: 'pay_1' });

  assert.equal(res.success, false);
  assert.equal(res.error, 'ORDER_EXPIRED');
});
