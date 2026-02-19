const app = getApp();
const { normalizeUserProfile, pickStoredUserProfile, isTempAvatarPath, uploadAvatarToCloud } = require('../../utils/userProfile.js');

Page({
  data: {
    userInfo: {
      nickName: '',
      avatarUrl: '',
      memberLevel: '',
      memberCardNo: '',
      points: 0,
      expireDate: ''
    },
    wxUserProfile: {
      nickName: '',
      avatarUrl: ''
    },
    pendingPhoneNumber: '',
    pendingMaskedPhoneNumber: '',
    pendingProfile: {
      nickName: '',
      avatarUrl: ''
    },
    needsProfileCompletion: false,
    showAddCourtModal: false,
    campus: '',
    courtNumber: '',
    phoneNumber: '',
    maskedPhoneNumber: '',
    orders: [],
    memberInfo: null,
    loading: false
  },

  maskPhoneNumber: function(phoneNumber) {
    if (!phoneNumber || phoneNumber.length !== 11) return phoneNumber || '';
    return phoneNumber.substr(0, 3) + '****' + phoneNumber.substr(7);
  },

  hydrateUserProfile: function() {
    const globalProfile = app.globalData.userProfile;
    const storedUserProfile = wx.getStorageSync('userProfile');
    const legacyUserInfo = wx.getStorageSync('userInfo');
    const { profile, source } = pickStoredUserProfile({
      userProfile: globalProfile || storedUserProfile,
      legacyUserInfo
    });

    if (profile) {
      if (!app.globalData.userProfile) {
        app.globalData.userProfile = profile;
      }
      app.globalData.userInfo = profile;
      if (source === 'legacyUserInfo') {
        wx.setStorageSync('userProfile', profile);
      }
      this.setData({ wxUserProfile: profile });
      this.ensureAvatarDisplayUrl(profile);
      return;
    }

    this.setData({
      wxUserProfile: {
        nickName: '',
        avatarUrl: '',
        avatarUrlForDisplay: ''
      }
    });
  },

  ensureAvatarDisplayUrl: function(profile) {
    const avatarUrl = (profile && profile.avatarUrl && profile.avatarUrl.trim()) || '';
    if (!avatarUrl) {
      this.setData({ 'wxUserProfile.avatarUrlForDisplay': '' });
      return;
    }
    if (!avatarUrl.startsWith('cloud://')) {
      this.setData({ 'wxUserProfile.avatarUrlForDisplay': avatarUrl });
      return;
    }
    wx.cloud.getTempFileURL({
      fileList: [avatarUrl],
      success: (res) => {
        const list = res.fileList || [];
        const file = list[0] || {};
        const tempUrl = file.tempFileURL || '';
        this.setData({
          'wxUserProfile.avatarUrlForDisplay': tempUrl || avatarUrl
        });
      },
      fail: () => {
        this.setData({
          'wxUserProfile.avatarUrlForDisplay': avatarUrl
        });
      }
    });
  },

  syncLoginViewState: function() {
    const phoneNumber = wx.getStorageSync('phoneNumber');
    const profile = normalizeUserProfile(this.data.wxUserProfile);

    if (phoneNumber && profile) {
      this.setData({
        phoneNumber,
        maskedPhoneNumber: this.maskPhoneNumber(phoneNumber),
        needsProfileCompletion: false
      });
      this.getMemberInfo();
      return;
    }

    if (phoneNumber && !profile) {
      this.setData({
        phoneNumber: '',
        maskedPhoneNumber: '',
        pendingPhoneNumber: phoneNumber,
        pendingMaskedPhoneNumber: this.maskPhoneNumber(phoneNumber),
        pendingProfile: {
          nickName: '',
          avatarUrl: ''
        },
        needsProfileCompletion: true
      });
      return;
    }

    this.setData({
      phoneNumber: '',
      maskedPhoneNumber: '',
      pendingPhoneNumber: '',
      pendingMaskedPhoneNumber: '',
      needsProfileCompletion: false
    });
  },

  ensureCloudAvatar: async function() {
    const phoneNumber = this.data.phoneNumber || wx.getStorageSync('phoneNumber');
    const profile = this.data.wxUserProfile || {};
    const avatarUrl = (profile.avatarUrl && profile.avatarUrl.trim()) || '';
    const nickName = (profile.nickName && profile.nickName.trim()) || '';
    if (!phoneNumber || !avatarUrl || !isTempAvatarPath(avatarUrl)) {
      return;
    }
    console.log('avatar upload start (member onShow)', avatarUrl);
    try {
      const newUrl = await uploadAvatarToCloud(avatarUrl, phoneNumber);
      console.log('avatar upload success (member onShow)', newUrl);
      const updated = { nickName: nickName || '微信用户', avatarUrl: newUrl };
      this.setData({ wxUserProfile: updated });
      this.ensureAvatarDisplayUrl(updated);
      wx.setStorageSync('userProfile', updated);
      app.globalData.userProfile = updated;
      app.globalData.userInfo = updated;
    } catch (e) {
      console.log('avatar upload fail (member onShow)', e);
    }
  },

  onLoad: function() {
    this.hydrateUserProfile();
    this.syncLoginViewState();
  },

  onShow: function() {
    this.hydrateUserProfile();
    this.syncLoginViewState();
    this.ensureCloudAvatar();
  },

  navigateToMyBookings: function() {
    wx.navigateTo({
      url: '/pages/myOrder/orderlist'
    });
  },

  navigateToChargedList: function() {
    wx.navigateTo({
      url: '/pages/chargedList/chargedList'
    });
  },

  navigateToSpendList: function() {
    wx.navigateTo({
      url: '/pages/spendList/spendList'
    });
  },

  navigateToPoints: function() {
    wx.navigateTo({
      url: '/pages/points/points'
    });
  },

  navigateToSettings: function() {
    wx.navigateTo({
      url: '/pages/settings/settings'
    });
  },

  showAddCourtModal: function() {
    this.setData({ showAddCourtModal: true });
  },

  handleModalCancel: function() {
    this.setData({ showAddCourtModal: false, campus: '', courtNumber: '' });
  },

  onCampusInput: function(e) {
    this.setData({ campus: e.detail.value });
  },

  onCourtNumberInput: function(e) {
    this.setData({ courtNumber: e.detail.value });
  },

  handleModalConfirm: function() {
    const { campus, courtNumber } = this.data;
    if (!campus || !courtNumber) {
      wx.showToast({ title: '请填写完整信息', icon: 'none' });
      return;
    }
    wx.cloud.callFunction({
      name: 'add_court',
      data: { campus, courtNumber },
      success: (res) => {
        if (res.result && res.result.success) {
          wx.showToast({ title: '添加成功', icon: 'success' });
          this.setData({ showAddCourtModal: false, campus: '', courtNumber: '' });
        } else {
          wx.showToast({ title: (res.result && res.result.error) || '添加失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络错误', icon: 'none' });
      }
    });
  },

  getOpenId() {
    return new Promise((resolve) => {
      wx.cloud.callFunction({
        name: 'getopenId',
        success(res) {
          console.log(res);
          resolve(res);
        },
        fail(err) {
          console.log(err);
          resolve(null);
        }
      });
    });
  },

  async getPhoneNumber(e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok') {
      wx.showToast({
        title: '您拒绝了手机号授权',
        icon: 'none'
      });
      console.warn('用户拒绝授权手机号');
      return;
    }

    this.getOpenId();

    const { encryptedData, iv, code } = e.detail;
    wx.cloud.callFunction({
      name: 'baseNumber',
      data: {
        encryptedData,
        iv,
        code
      },
      success: (res) => {
        const phoneNumber = res && res.result && res.result.phoneInfo && res.result.phoneInfo.phoneNumber;

        if (res.result && res.result.errCode === 0 && phoneNumber) {
          this.setData({
            pendingPhoneNumber: phoneNumber,
            pendingMaskedPhoneNumber: this.maskPhoneNumber(phoneNumber),
            pendingProfile: {
              nickName: '',
              avatarUrl: ''
            },
            needsProfileCompletion: true
          });
          wx.showToast({
            title: '请继续完善头像和昵称',
            icon: 'none'
          });
        } else {
          wx.showToast({
            title: '手机号解密失败',
            icon: 'error'
          });
          console.error('获取手机号失败', res.result ? res.result.error : res);
        }
      },
      fail: (err) => {
        wx.showToast({
          title: '登录失败，请稍后重试',
          icon: 'error'
        });
        console.error('云函数调用失败', err);
      }
    });
  },

  onChooseAvatar: function(e) {
    const avatarUrl = e && e.detail && e.detail.avatarUrl;
    if (!avatarUrl) {
      return;
    }
    this.setData({
      'pendingProfile.avatarUrl': avatarUrl
    });
  },

  onNicknameInput: function(e) {
    const nickName = (e && e.detail && e.detail.value ? e.detail.value : '').trim();
    this.setData({
      'pendingProfile.nickName': nickName
    });
  },

  noop: function() {},

  confirmProfileAndLogin: async function() {
    const { pendingPhoneNumber, pendingProfile } = this.data;
    if (!pendingPhoneNumber) {
      wx.showToast({ title: '请先完成手机号授权', icon: 'none' });
      return;
    }
    let avatarUrl = (pendingProfile.avatarUrl && pendingProfile.avatarUrl.trim()) || '';
    const nickName = (pendingProfile.nickName && pendingProfile.nickName.trim()) || '';
    if (!nickName || !avatarUrl) {
      wx.showToast({ title: '请补充头像和昵称', icon: 'none' });
      return;
    }
    if (isTempAvatarPath(avatarUrl)) {
      console.log('avatar upload start (member)', avatarUrl);
      wx.showLoading({ title: '上传头像...' });
      try {
        avatarUrl = await uploadAvatarToCloud(avatarUrl, pendingPhoneNumber);
        console.log('avatar upload success (member)', avatarUrl);
      } catch (e) {
        console.log('avatar upload fail (member)', e);
        wx.hideLoading();
        wx.showToast({ title: '头像上传失败', icon: 'none' });
        return;
      }
      wx.hideLoading();
    }
    const profile = { nickName, avatarUrl };

    this.setData({
      phoneNumber: pendingPhoneNumber,
      maskedPhoneNumber: this.maskPhoneNumber(pendingPhoneNumber),
      wxUserProfile: profile,
      pendingPhoneNumber: '',
      pendingMaskedPhoneNumber: '',
      pendingProfile: { nickName: '', avatarUrl: '' },
      needsProfileCompletion: false
    });
    this.ensureAvatarDisplayUrl(profile);

    wx.setStorageSync('phoneNumber', pendingPhoneNumber);
    wx.setStorageSync('userProfile', profile);
    wx.setStorageSync('userInfo', profile);
    app.globalData.userProfile = profile;
    app.globalData.userInfo = profile;

    wx.showToast({ title: '登录成功', icon: 'success' });
    this.getMemberInfo();
    const redirect = wx.getStorageSync('postLoginRedirect');
    if (redirect && redirect.page === 'rushDetail' && redirect.rushId) {
      wx.removeStorageSync('postLoginRedirect');
      wx.navigateTo({ url: `/pages/rushDetail/rushDetail?rushId=${redirect.rushId}` });
    }
  },

  getMemberInfo: function() {
    const { phoneNumber } = this.data;
    if (!phoneNumber) {
      return;
    }

    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'club_member',
      data: {
        phoneNumber: phoneNumber
      },
      success: (res) => {
        this.setData({ loading: false });
        if (res.result && res.result.success) {
          this.setData({
            memberInfo: res.result.data
          });
        } else {
          this.setData({ memberInfo: null });
          if (res.result && res.result.message) {
            console.log('查询会员信息失败:', res.result.message);
          }
        }
      },
      fail: (err) => {
        this.setData({ loading: false, memberInfo: null });
        console.error('查询会员信息失败:', err);
      }
    });
  }
});
