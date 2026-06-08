const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

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

function createCloudMock(rushes, expiredEnrollments = [], onProcessing = null) {
  const updates = [];
  const removedRushIds = [];
  const rushMap = new Map(rushes.map((rush) => [rush._id, rush]));
  const command = {
    eq: (value) => ({ $eq: value }),
    neq: (value) => ({ $neq: value }),
    lt: (value) => ({ $lt: value }),
    gt: (value) => ({
      $gt: value,
      and(other) {
        return { $and: [this, other] };
      },
    }),
    gte: (value) => ({
      $gte: value,
      and(other) {
        return { $and: [this, other] };
      },
    }),
    lte: (value) => ({ $lte: value }),
    inc: (value) => ({ $inc: value }),
  };

  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'test',
    init: () => {},
    database: () => ({
      command,
      serverDate: () => new Date(),
      collection: (name) => {
        if (name === 'court_rush') {
          return {
            where: (query) => ({
              get: async () => ({ data: rushes }),
              update: async ({ data }) => {
                const rush = rushMap.get(query._id);
                if (query.held_participants && query.held_participants.$gt === 0) {
                  if (!rush || rush.held_participants <= 0) return { stats: { updated: 0 } };
                  rush.held_participants += data.held_participants.$inc;
                  updates.push({ query, data });
                  return { stats: { updated: 1 } };
                }
                if (query.auto_cancel_status === 'PROCESSING') {
                  if (!rush || rush.auto_cancel_status !== 'PROCESSING') return { stats: { updated: 0 } };
                  Object.assign(rush, data);
                  updates.push({ query, data });
                  return { stats: { updated: 1 } };
                }
                const eligible = rush
                  && rush.max_participants === query.max_participants
                  && rush.current_participants === query.current_participants
                  && rush.held_participants === query.held_participants
                  && rush.status === query.status
                  && rush.auto_cancel_status !== query.auto_cancel_status.$neq;
                if (!eligible) return { stats: { updated: 0 } };
                Object.assign(rush, data);
                if (data.auto_cancel_status === 'PROCESSING' && onProcessing) onProcessing(rush);
                updates.push({ query, data });
                return { stats: { updated: 1 } };
              },
            }),
            doc: (rushId) => ({
              get: async () => ({ data: rushMap.get(rushId) }),
              update: async ({ data }) => {
                Object.assign(rushMap.get(rushId), data);
                updates.push({ rushId, data });
                return { stats: { updated: 1 } };
              },
            }),
          };
        }

        if (name === 'court_rush_enrollment') {
          return {
            where: (query) => ({
              get: async () => ({
                data: query.status === 'PENDING_PAYMENT' && query.expires_at
                  ? expiredEnrollments.filter((row) => row.court_rush_id === query.court_rush_id)
                  : [],
              }),
              update: async ({ data }) => {
                const enrollment = expiredEnrollments.find((row) => row._id === query._id);
                if (!enrollment || enrollment.status !== query.status) return { stats: { updated: 0 } };
                Object.assign(enrollment, data);
                updates.push({ query, data });
                return { stats: { updated: 1 } };
              },
            }),
          };
        }

        if (name === 'court_order_collection') {
          return {
            where: (query) => ({
              remove: async () => {
                removedRushIds.push(query.rush_id);
                return { stats: { removed: 1 } };
              },
            }),
          };
        }

        throw new Error(`unexpected collection: ${name}`);
      },
    }),
  };

  return { cloudMock, updates, removedRushIds };
}

const modulePath = path.resolve(__dirname, '../../cloudfunctions/court_rush_auto_cancel/index.js');

test('scheduled scan runs every three minutes, shorter than the four-minute payment validity period', () => {
  const configPath = path.resolve(__dirname, '../../cloudfunctions/court_rush_auto_cancel/config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const trigger = config.triggers && config.triggers[0];

  assert.equal(trigger.type, 'timer');
  assert.equal(trigger.config, '0 */3 * * * * *');
});

test('auto-cancels a four-person rush with fewer than two paid or paying participants', async () => {
  const rush = {
    _id: 'rush_1',
    max_participants: 4,
    current_participants: 1,
    held_participants: 0,
    status: 'OPEN',
    start_at: new Date(Date.now() + 10 * 60 * 1000),
  };
  const { cloudMock, removedRushIds } = createCloudMock([rush]);
  const { main } = loadWithMock(modulePath, cloudMock);

  const result = await main({});

  assert.equal(result.success, true);
  assert.equal(rush.status, 'CANCELLED');
  assert.equal(rush.auto_cancel_status, 'DONE');
  assert.deepEqual(removedRushIds, ['rush_1']);
});

test('does not auto-cancel when paid and paying participants total two', async () => {
  const rush = {
    _id: 'rush_held',
    max_participants: 4,
    current_participants: 1,
    held_participants: 1,
    status: 'OPEN',
    start_at: new Date(Date.now() + 10 * 60 * 1000),
  };
  const { cloudMock, updates, removedRushIds } = createCloudMock([rush]);
  const { main } = loadWithMock(modulePath, cloudMock);

  await main({});

  assert.equal(updates.length, 0);
  assert.deepEqual(removedRushIds, []);
});

test('cleans an expired paying participant before deciding to auto-cancel', async () => {
  const rush = {
    _id: 'rush_expired_held',
    max_participants: 4,
    current_participants: 1,
    held_participants: 1,
    status: 'OPEN',
    start_at: new Date(Date.now() + 10 * 60 * 1000),
  };
  const expiredEnrollments = [{
    _id: 'enroll_expired',
    court_rush_id: rush._id,
    status: 'PENDING_PAYMENT',
  }];
  const { cloudMock, removedRushIds } = createCloudMock([rush], expiredEnrollments);
  const { main } = loadWithMock(modulePath, cloudMock);

  await main({});

  assert.equal(expiredEnrollments[0].status, 'EXPIRED');
  assert.equal(rush.status, 'CANCELLED');
  assert.deepEqual(removedRushIds, [rush._id]);
});

test('does not auto-cancel a rush after its start time', async () => {
  const rush = {
    _id: 'rush_started',
    max_participants: 4,
    current_participants: 0,
    held_participants: 0,
    status: 'OPEN',
    start_at: new Date(Date.now() - 60 * 1000),
  };
  const { cloudMock, updates, removedRushIds } = createCloudMock([rush]);
  const { main } = loadWithMock(modulePath, cloudMock);

  await main({});

  assert.equal(updates.length, 0);
  assert.deepEqual(removedRushIds, []);
});

test('does not finalize cancellation if the rush starts during the scan', async () => {
  const rush = {
    _id: 'rush_starts_during_scan',
    max_participants: 4,
    current_participants: 0,
    held_participants: 0,
    status: 'OPEN',
    start_at: new Date(Date.now() + 10 * 60 * 1000),
  };
  const onProcessing = (processingRush) => {
    processingRush.start_at = new Date(Date.now() - 1000);
  };
  const { cloudMock, removedRushIds } = createCloudMock([rush], [], onProcessing);
  const { main } = loadWithMock(modulePath, cloudMock);

  await main({});

  assert.equal(rush.status, 'OPEN');
  assert.equal(rush.auto_cancel_status, 'NOT_STARTED');
  assert.deepEqual(removedRushIds, []);
});

test('does not finalize cancellation when another scan owns the processing state', async () => {
  const rush = {
    _id: 'rush_processing',
    max_participants: 4,
    current_participants: 0,
    held_participants: 0,
    status: 'OPEN',
    auto_cancel_status: 'PROCESSING',
    start_at: new Date(Date.now() + 10 * 60 * 1000),
  };
  const { cloudMock, updates, removedRushIds } = createCloudMock([rush]);
  const { main } = loadWithMock(modulePath, cloudMock);

  await main({});

  assert.equal(updates.length, 0);
  assert.deepEqual(removedRushIds, []);
});

test('does not auto-cancel a two-person rush', async () => {
  const rush = {
    _id: 'rush_2',
    max_participants: 2,
    current_participants: 0,
    held_participants: 0,
    status: 'OPEN',
    start_at: new Date(Date.now() + 10 * 60 * 1000),
  };
  const { cloudMock, updates, removedRushIds } = createCloudMock([rush]);
  const { main } = loadWithMock(modulePath, cloudMock);

  await main({});

  assert.equal(updates.length, 0);
  assert.deepEqual(removedRushIds, []);
});

test('does not auto-cancel a four-person rush with two paid participants', async () => {
  const rush = {
    _id: 'rush_3',
    max_participants: 4,
    current_participants: 2,
    held_participants: 0,
    status: 'OPEN',
    start_at: new Date(Date.now() + 10 * 60 * 1000),
  };
  const { cloudMock, updates, removedRushIds } = createCloudMock([rush]);
  const { main } = loadWithMock(modulePath, cloudMock);

  await main({});

  assert.equal(updates.length, 0);
  assert.deepEqual(removedRushIds, []);
});
