function normalizeUserProfile(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const nickName = typeof input.nickName === 'string' ? input.nickName.trim() : '';
  const avatarUrl = typeof input.avatarUrl === 'string' ? input.avatarUrl.trim() : '';

  if (!nickName || !avatarUrl) {
    return null;
  }

  return { nickName, avatarUrl };
}

function pickStoredUserProfile({ userProfile, legacyUserInfo }) {
  const normalizedUserProfile = normalizeUserProfile(userProfile);
  if (normalizedUserProfile) {
    return { profile: normalizedUserProfile, source: 'userProfile' };
  }

  const normalizedLegacyUserInfo = normalizeUserProfile(legacyUserInfo);
  if (normalizedLegacyUserInfo) {
    return { profile: normalizedLegacyUserInfo, source: 'legacyUserInfo' };
  }

  return { profile: null, source: null };
}

module.exports = {
  normalizeUserProfile,
  pickStoredUserProfile,
};
