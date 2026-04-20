function isTempAvatarPath(url) {
  if (!url || typeof url !== 'string') return false;
  const s = url.trim();
  return s.startsWith('wxfile://') || s.startsWith('http://tmp/') || s.startsWith('https://tmp/') || s.startsWith('/tmp/');
}

function uploadAvatarToCloud(filePath, phoneNumber) {
  const ext = (filePath.match(/\.(jpeg|jpg|png|gif|webp)$/i) || [])[1] || 'jpg';
  const baseName = (phoneNumber && typeof phoneNumber === 'string' && phoneNumber.trim())
    ? phoneNumber.trim()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const cloudPath = `avatars/${baseName}.${ext}`;
  return wx.cloud.uploadFile({
    cloudPath,
    filePath,
  }).then((res) => res.fileID);
}

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
  isTempAvatarPath,
  uploadAvatarToCloud,
};
