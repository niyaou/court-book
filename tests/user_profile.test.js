const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeUserProfile, pickStoredUserProfile } = require('../utils/userProfile');

test('normalizeUserProfile keeps valid nickName and avatarUrl', () => {
  const profile = normalizeUserProfile({ nickName: 'Alice', avatarUrl: 'https://img' });
  assert.deepEqual(profile, { nickName: 'Alice', avatarUrl: 'https://img' });
});

test('normalizeUserProfile returns null for invalid values', () => {
  assert.equal(normalizeUserProfile(null), null);
  assert.equal(normalizeUserProfile({ nickName: '', avatarUrl: 'https://img' }), null);
  assert.equal(normalizeUserProfile({ nickName: 'Alice', avatarUrl: '' }), null);
});

test('pickStoredUserProfile prefers userProfile over legacy userInfo', () => {
  const fromUserProfile = pickStoredUserProfile({
    userProfile: { nickName: 'A', avatarUrl: '1' },
    legacyUserInfo: { nickName: 'B', avatarUrl: '2' },
  });
  assert.deepEqual(fromUserProfile, {
    profile: { nickName: 'A', avatarUrl: '1' },
    source: 'userProfile',
  });

  const fromLegacy = pickStoredUserProfile({
    userProfile: null,
    legacyUserInfo: { nickName: 'B', avatarUrl: '2' },
  });
  assert.deepEqual(fromLegacy, {
    profile: { nickName: 'B', avatarUrl: '2' },
    source: 'legacyUserInfo',
  });

  const empty = pickStoredUserProfile({ userProfile: null, legacyUserInfo: null });
  assert.deepEqual(empty, { profile: null, source: null });
});
