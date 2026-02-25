const { isTempAvatarPath, uploadAvatarToCloud } = require('../../utils/userProfile.js');
const DEFAULT_AVATAR_URL = 'cloud://cloud1-6gebob4m4ba8f3de.636c-cloud1-6gebob4m4ba8f3de-1357716382/mp_asset/default_avatar.png';

function genNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i += 1) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

Page({
  data: {
    rushId: '',
    phoneNumber: '',
    detail: null,
    loading: false,
    enrollLoading: false,
    isManager: false,
  },

  onLoad(options) {
    const rushId = options.rushId || '';
    this.setData({ rushId });
  },

  onShow() {
    const phoneNumber = wx.getStorageSync('phoneNumber') || '';
    const app = getApp();
    const courtRushManagerList = app.globalData.courtRushManagerList || [];
    const isManager = courtRushManagerList.includes(phoneNumber);
    this.setData({ phoneNumber, isManager });

    if (!phoneNumber) {
      wx.setStorageSync('postLoginRedirect', { page: 'rushDetail', rushId: this.data.rushId });
      wx.switchTab({ url: '/pages/member/member' });
      return;
    }

    this.loadDetail();
  },

  onShareAppMessage() {
    return {
      title: '畅打报名',
      path: `/pages/rushDetail/rushDetail?rushId=${this.data.rushId}`
    };
  },

  formatRushTimeRange(startIso, endIso) {
    const fmt = (iso, withDate) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0'); const h = String(d.getHours()).padStart(2, '0'); const min = String(d.getMinutes()).padStart(2, '0');
      return withDate ? `${y}${m}${day} ${h}:${min}` : `${h}:${min}`;
    };
    const start = fmt(startIso, true);
    const end = fmt(endIso, false);
    return start && end ? `${start} - ${end}` : start || end || '';
  },

  async loadDetail() {
    this.setData({ loading: true });
    try {
      const phoneNumber = wx.getStorageSync('phoneNumber') || this.data.phoneNumber;
      const res = await wx.cloud.callFunction({
        name: 'court_rush_detail',
        data: { rushId: this.data.rushId, phoneNumber, clientNow: Date.now() }
      });
      const data = res.result && res.result.data;
      if (data && data.rush) {
        const r = data.rush;
        r.time_display = this.formatRushTimeRange(r.start_at, r.end_at);
      }
      this.setData({ detail: data });
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async enroll() {
    const openid = wx.getStorageSync('openid');
    const app = getApp();
    const userProfile = wx.getStorageSync('userProfile') || app.globalData.userProfile || {};
    let nickName = (userProfile.nickName && userProfile.nickName.trim()) || '微信用户';
    let avatarUrl = (userProfile.avatarUrl && userProfile.avatarUrl.trim()) || DEFAULT_AVATAR_URL;
    if (isTempAvatarPath(avatarUrl)) {
      console.log('avatar upload start (rushDetail)', avatarUrl);
      try {
        wx.showLoading({ title: '上传头像...' });
        avatarUrl = await uploadAvatarToCloud(avatarUrl, this.data.phoneNumber || '');
        console.log('avatar upload success (rushDetail)', avatarUrl);
        wx.hideLoading();
        const updated = { nickName, avatarUrl };
        wx.setStorageSync('userProfile', updated);
        if (app.globalData.userProfile) app.globalData.userProfile = updated;
      } catch (e) {
        console.log('avatar upload fail (rushDetail)', e);
        wx.hideLoading();
        wx.showToast({ title: '头像上传失败', icon: 'none' });
        return;
      }
    }
    this.setData({ enrollLoading: true });
    wx.showLoading({ title: '报名中...' });
    const timeoutMs = 60000;
    const timeoutId = setTimeout(() => {
      if (this._enrollTimedOut) return;
      this._enrollTimedOut = true;
      wx.hideLoading();
      this.setData({ enrollLoading: false });
      wx.showToast({ title: '请求超时', icon: 'none' });
    }, timeoutMs);
    this._enrollTimedOut = false;
    try {
      const res = await wx.cloud.callFunction({
        name: 'court_rush_enroll',
        data: {
          court_rush_id: this.data.rushId,
          phoneNumber: this.data.phoneNumber,
          openid,
          nonceStr: genNonce(),
          nickName,
          avatarUrl,
        }
      });
      clearTimeout(timeoutId);
      if (this._enrollTimedOut) return;
      wx.hideLoading();
      this.setData({ enrollLoading: false });
      const result = res.result || {};
      if (!result.success) {
        wx.showToast({ title: result.error || '报名失败', icon: 'none' });
        return;
      }
      if (result.payment) {
        await this.requestPay(result.payment);
      }
      this.loadDetail();
    } catch (err) {
      clearTimeout(timeoutId);
      if (!this._enrollTimedOut) {
        wx.hideLoading();
        this.setData({ enrollLoading: false });
      }
      wx.showToast({ title: '报名失败', icon: 'none' });
    }
  },

  async continuePay() {
    const payment = this.data.detail && this.data.detail.myPayment;
    if (!payment) return;
    try {
      const query = await wx.cloud.callFunction({
        name: 'court_rush_pay_query',
        data: { paymentId: payment._id }
      });
      const result = query.result || {};
      if (!result.success) {
        wx.showToast({ title: '订单已过期', icon: 'none' });
        this.loadDetail();
        return;
      }
      await this.requestPay(result.order.payment_parmas || result.order.payment_params);
      this.loadDetail();
    } catch (err) {
      wx.showToast({ title: '续付失败', icon: 'none' });
    }
  },

  requestPay(paymentParams) {
    return new Promise((resolve, reject) => {
      wx.requestPayment({
        ...paymentParams,
        success: () => {
          wx.showToast({ title: '支付成功', icon: 'success' });
          resolve();
        },
        fail: (err) => {
          wx.showToast({ title: '支付未完成', icon: 'none' });
          reject(err);
        }
      });
    });
  },

  async refund() {
    const enrollment = this.data.detail && this.data.detail.myEnrollment;
    if (!enrollment) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'court_rush_refund',
        data: {
          enrollment_id: enrollment._id,
          phoneNumber: this.data.phoneNumber,
          nonceStr: genNonce()
        }
      });
      if (res.result && res.result.success) {
        wx.showToast({ title: '已发起退款', icon: 'success' });
      } else {
        wx.showToast({ title: (res.result && res.result.error) || '退款失败', icon: 'none' });
      }
      this.loadDetail();
    } catch (err) {
      wx.showToast({ title: '退款失败', icon: 'none' });
    }
  },

  async cancelRush() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'court_rush_cancel',
        data: { rushId: this.data.rushId, phoneNumber: this.data.phoneNumber }
      });
      if (res.result && res.result.success) {
        wx.showToast({ title: '已取消整场', icon: 'success' });
      } else {
        wx.showToast({ title: (res.result && res.result.error) || '取消失败', icon: 'none' });
      }
      this.loadDetail();
    } catch (err) {
      wx.showToast({ title: '取消失败', icon: 'none' });
    }
  }
});
