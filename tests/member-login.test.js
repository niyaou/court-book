const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadMemberPage(initialStorage = {}, cloudOverrides = {}) {
  const storage = new Map(Object.entries(initialStorage));
  const app = {
    globalData: { eventBus: { on() {}, off() {} } },
    ensureCoachContext() {}
  };
  let definition;
  const wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    showToast() {},
    cloud: {
      uploadFile: async ({ cloudPath }) => ({ fileID: `cloud://test/${cloudPath}` }),
      getTempFileURL: ({ fileList, success }) => success({
        fileList: [{ tempFileURL: `https://example.com/${fileList[0]}` }]
      }),
      callFunction({ name, success }) {
        if (name === 'baseNumber') {
          success({ result: { errCode: 0, phoneInfo: { phoneNumber: '13800000000' } } });
        }
      },
      ...cloudOverrides
    }
  };
  const profileModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/userProfile.js'), 'utf8'), {
    module: profileModule, wx
  });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/member/member.js'), 'utf8'), {
    Page: (page) => { definition = page; },
    getApp: () => app,
    require: () => profileModule.exports,
    wx,
    console
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.split('.');
        let target = this.data;
        for (const part of parts.slice(0, -1)) target = target[part];
        target[parts.at(-1)] = value;
      }
    }
  };
  page.onLoad();
  page.onShow();
  return { page, storage, app, profileUtils: profileModule.exports };
}

for (const avatarFirst of [false, true]) {
  test(`album return preserves the login draft when avatar callback comes ${avatarFirst ? 'before' : 'after'} onShow`, async () => {
    const { page, storage, app } = loadMemberPage();
    await page.getPhoneNumber({ detail: { errMsg: 'getPhoneNumber:ok', code: 'test-code' } });
    page.onNicknameInput({ detail: { value: '网球学员' } });
    const chooseAvatar = () => page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp/avatar.jpg' } });
    if (avatarFirst) chooseAvatar();
    page.onShow();
    if (!avatarFirst) chooseAvatar();

    assert.equal(page.data.needsProfileCompletion, true);
    assert.equal(page.data.pendingPhoneNumber, '13800000000');
    assert.equal(page.data.pendingMaskedPhoneNumber, '138****0000');
    assert.equal(page.data.pendingProfile.nickName, '网球学员');
    assert.equal(page.data.pendingProfile.avatarUrl, 'wxfile://tmp/avatar.jpg');
    assert.equal(storage.has('phoneNumber'), false);

    await page.confirmProfileAndLogin();
    assert.equal(page.data.phoneNumber, '13800000000');
    assert.equal(page.data.needsProfileCompletion, false);
    assert.equal(page.data.pendingPhoneNumber, '');
    assert.equal(storage.get('phoneNumber'), '13800000000');
    assert.equal(storage.get('userProfile').nickName, '网球学员');
    assert.match(app.globalData.userProfile.avatarUrl, /^cloud:\/\//);
    assert.equal(app.globalData.userProfile.avatarUrl, storage.get('userProfile').avatarUrl);
  });
}

test('returning without an avatar callback preserves the draft and still requires an avatar', async () => {
  const { page, storage } = loadMemberPage();
  await page.getPhoneNumber({ detail: { errMsg: 'getPhoneNumber:ok' } });
  page.onNicknameInput({ detail: { value: '网球学员' } });
  page.onShow();
  page.onShow();
  await page.confirmProfileAndLogin();
  assert.equal(page.data.needsProfileCompletion, true);
  assert.equal(page.data.pendingPhoneNumber, '13800000000');
  assert.equal(page.data.pendingProfile.nickName, '网球学员');
  assert.equal(storage.has('phoneNumber'), false);
});

test('a stored phone with incomplete profile does not reset edits on return', () => {
  const { page } = loadMemberPage({ phoneNumber: '13800000000' });
  page.onNicknameInput({ detail: { value: '网球学员' } });
  page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp/avatar.jpg' } });
  page.onShow();
  assert.equal(page.data.needsProfileCompletion, true);
  assert.equal(page.data.pendingProfile.nickName, '网球学员');
  assert.equal(page.data.pendingProfile.avatarUrl, 'wxfile://tmp/avatar.jpg');
});

test('initial logged-out and completed login states still restore normally', () => {
  const loggedOut = loadMemberPage().page;
  assert.equal(loggedOut.data.phoneNumber, '');
  assert.equal(loggedOut.data.needsProfileCompletion, false);

  const { page } = loadMemberPage({
    phoneNumber: '13800000000',
    userProfile: { nickName: '网球学员', avatarUrl: 'https://example.com/avatar.jpg' }
  });
  assert.equal(page.data.phoneNumber, '13800000000');
  assert.equal(page.data.wxUserProfile.nickName, '网球学员');
  assert.equal(page.data.needsProfileCompletion, false);
});

async function fillLoginDraft(page) {
  await page.getPhoneNumber({ detail: { errMsg: 'getPhoneNumber:ok' } });
  page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp/album.jpg' } });
  page.onNicknameInput({ detail: { value: '新昵称' } });
}

for (const outcome of ['success', 'fail']) {
  test(`late old avatar URL ${outcome} cannot replace the selected album avatar`, async () => {
    const requests = [];
    const { page, storage, app } = loadMemberPage({
      userProfile: { nickName: '旧昵称', avatarUrl: 'cloud://old-wechat-avatar' }
    }, { getTempFileURL: (options) => requests.push(options) });
    const oldRequests = requests.slice();
    await fillLoginDraft(page);
    await page.confirmProfileAndLogin();
    const selected = page.data.wxUserProfile.avatarUrl;
    requests.at(-1).success({ fileList: [{ tempFileURL: 'https://example.com/new-album.jpg' }] });
    for (const request of oldRequests) {
      if (outcome === 'success') request.success({ fileList: [{ tempFileURL: 'https://example.com/old-wechat.jpg' }] });
      else request.fail();
    }
    assert.equal(page.data.wxUserProfile.avatarUrlForDisplay, 'https://example.com/new-album.jpg');
    assert.equal(storage.get('userProfile').avatarUrl, selected);
    assert.equal(app.globalData.userProfile.avatarUrl, selected);
    page.onShow();
    assert.equal(page.data.wxUserProfile.avatarUrl, selected);
  });
}

test('late background upload of an old avatar cannot overwrite a newly completed login', async () => {
  let resolveOldUpload;
  const { page, storage, app } = loadMemberPage({
    phoneNumber: '13800000000',
    userProfile: { nickName: '旧昵称', avatarUrl: 'wxfile://tmp/old.jpg' }
  }, {
    uploadFile: ({ filePath }) => filePath.endsWith('old.jpg')
      ? new Promise((resolve) => { resolveOldUpload = resolve; })
      : Promise.resolve({ fileID: 'cloud://new-album-avatar' })
  });
  await fillLoginDraft(page);
  await page.confirmProfileAndLogin();
  resolveOldUpload({ fileID: 'cloud://old-wechat-avatar' });
  await new Promise(setImmediate);
  for (const profile of [page.data.wxUserProfile, storage.get('userProfile'), storage.get('userInfo'), app.globalData.userProfile, app.globalData.userInfo]) {
    assert.equal(profile.avatarUrl, 'cloud://new-album-avatar');
    assert.equal(profile.nickName, '新昵称');
  }
});

test('login waits for the selected file to upload and ignores duplicate submissions', async () => {
  const uploads = [];
  let finishUpload;
  const { page, storage } = loadMemberPage({}, {
    uploadFile: (options) => {
      uploads.push(options);
      return new Promise((resolve) => { finishUpload = resolve; });
    }
  });
  await fillLoginDraft(page);
  const login = page.confirmProfileAndLogin();
  await page.confirmProfileAndLogin();
  page.onShow();
  assert.equal(page.data.profileSubmitting, true);
  assert.equal(page.data.needsProfileCompletion, true);
  assert.equal(storage.has('phoneNumber'), false);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].filePath, 'wxfile://tmp/album.jpg');
  finishUpload({ fileID: 'cloud://new-album-avatar' });
  await login;
  assert.equal(page.data.profileSubmitting, false);
  assert.equal(storage.get('userProfile').avatarUrl, 'cloud://new-album-avatar');
});

test('failed upload preserves the draft for retry without completing login', async () => {
  let failUpload = true;
  const { page, storage } = loadMemberPage({}, {
    uploadFile: async () => {
      if (failUpload) throw new Error('test upload failure');
      return { fileID: 'cloud://retried-album-avatar' };
    }
  });
  await fillLoginDraft(page);
  await page.confirmProfileAndLogin();
  assert.equal(storage.has('phoneNumber'), false);
  assert.equal(page.data.profileSubmitting, false);
  assert.equal(page.data.needsProfileCompletion, true);
  assert.equal(page.data.pendingProfile.avatarUrl, 'wxfile://tmp/album.jpg');
  failUpload = false;
  await page.confirmProfileAndLogin();
  assert.equal(storage.get('userProfile').avatarUrl, 'cloud://retried-album-avatar');
});

test('different avatar uploads for one phone use distinct file addresses', async () => {
  const { profileUtils } = loadMemberPage();
  const first = await profileUtils.uploadAvatarToCloud('wxfile://tmp/first.jpg', '13800000000');
  const second = await profileUtils.uploadAvatarToCloud('wxfile://tmp/second.jpg', '13800000000');
  assert.notEqual(first, second);
});
