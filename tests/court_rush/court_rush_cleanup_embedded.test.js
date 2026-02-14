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

test('court_rush_list synchronously cleans expired enrollments before returning data', async () => {
  let enrollmentUpdated = 0;
  let rushUpdated = 0;

  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'test',
    init: () => {},
    database: () => {
      const command = {
        lt: (v) => ({ $lt: v }),
        gt: (v) => ({ $gt: v }),
        in: (v) => ({ $in: v }),
        inc: (v) => ({ $inc: v }),
      };

      return {
        command,
        serverDate: () => ({ $date: true }),
        collection: (name) => {
          if (name === 'court_rush_enrollment') {
            return {
              where: (query) => {
                if (query.status === 'PENDING_PAYMENT' && query.expires_at) {
                  return {
                    get: async () => ({ data: [{ _id: 'enroll_1', court_rush_id: 'rush_1' }] }),
                  };
                }
                if (query._id === 'enroll_1' && query.status === 'PENDING_PAYMENT') {
                  return {
                    update: async () => {
                      enrollmentUpdated += 1;
                      return { stats: { updated: 1 } };
                    },
                  };
                }
                if (query.phoneNumber === '13800000000') {
                  return {
                    get: async () => ({ data: [] }),
                  };
                }
                throw new Error(`unexpected enrollment where query: ${JSON.stringify(query)}`);
              },
            };
          }

          if (name === 'court_rush') {
            return {
              where: (query) => {
                if (query._id === 'rush_1' && query.held_participants) {
                  return {
                    update: async () => {
                      rushUpdated += 1;
                      return { stats: { updated: 1 } };
                    },
                  };
                }

                return {
                  limit: () => ({
                    get: async () => ({
                      data: [{ _id: 'rush_1', start_at: new Date(Date.now() + 60 * 1000), status: 'OPEN' }],
                    }),
                  }),
                };
              },
            };
          }

          throw new Error(`unexpected collection: ${name}`);
        },
      };
    },
  };

  const { main } = loadWithMock('d:/project/court-book/cloudfunctions/court_rush_list/index.js', cloudMock);
  const res = await main({ phoneNumber: '13800000000' });

  assert.equal(res.success, true);
  assert.equal(enrollmentUpdated, 1);
  assert.equal(rushUpdated, 1);
});

test('court_rush_detail synchronously cleans expired enrollments only for current rush', async () => {
  let cleanupWhere = null;
  let enrollmentUpdated = 0;
  let rushUpdated = 0;

  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'test',
    init: () => {},
    database: () => {
      const command = {
        lt: (v) => ({ $lt: v }),
        gt: (v) => ({ $gt: v }),
        inc: (v) => ({ $inc: v }),
      };

      return {
        command,
        serverDate: () => ({ $date: true }),
        collection: (name) => {
          if (name === 'court_rush_enrollment') {
            return {
              where: (query) => {
                if (query.status === 'PENDING_PAYMENT' && query.expires_at) {
                  cleanupWhere = query;
                  return {
                    get: async () => ({ data: [{ _id: 'enroll_2', court_rush_id: 'rush_1' }] }),
                  };
                }
                if (query._id === 'enroll_2' && query.status === 'PENDING_PAYMENT') {
                  return {
                    update: async () => {
                      enrollmentUpdated += 1;
                      return { stats: { updated: 1 } };
                    },
                  };
                }
                throw new Error(`unexpected enrollment where query: ${JSON.stringify(query)}`);
              },
            };
          }

          if (name === 'court_rush') {
            return {
              doc: () => ({
                get: async () => ({ data: { _id: 'rush_1', start_at: new Date(Date.now() + 7 * 60 * 60 * 1000), status: 'OPEN' } }),
              }),
              where: (query) => {
                if (query._id === 'rush_1' && query.held_participants) {
                  return {
                    update: async () => {
                      rushUpdated += 1;
                      return { stats: { updated: 1 } };
                    },
                  };
                }
                throw new Error(`unexpected rush where query: ${JSON.stringify(query)}`);
              },
            };
          }

          if (name === 'court_rush_payment') {
            return {
              where: () => ({
                limit: () => ({ get: async () => ({ data: [] }) }),
              }),
            };
          }

          throw new Error(`unexpected collection: ${name}`);
        },
      };
    },
  };

  const { main } = loadWithMock('d:/project/court-book/cloudfunctions/court_rush_detail/index.js', cloudMock);
  const res = await main({ rushId: 'rush_1' });

  assert.equal(res.success, true);
  assert.equal(cleanupWhere.court_rush_id, 'rush_1');
  assert.equal(enrollmentUpdated, 1);
  assert.equal(rushUpdated, 1);
});