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

test('court_rush_order_callback skips duplicate callback when payment is not pending', async () => {
  let paymentUpdateCalled = false;

  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'test',
    init: () => {},
    database: () => ({
      collection: () => ({
        where: () => ({
          limit: () => ({
            get: async () => ({ data: [{ _id: 'p1', status: 'PAIDED' }] }),
          }),
          update: async () => { paymentUpdateCalled = true; return { stats: { updated: 1 } }; },
        }),
        doc: () => ({
          update: async () => { paymentUpdateCalled = true; return { stats: { updated: 1 } }; },
        }),
      }),
    }),
  };

  const { main } = loadWithMock('d:/project/court-book/cloudfunctions/court_rush_order_callback/index.js', cloudMock);
  const res = await main({ outTradeNo: 'otn_1' });

  assert.equal(res.errcode, 0);
  assert.equal(paymentUpdateCalled, false);
});
