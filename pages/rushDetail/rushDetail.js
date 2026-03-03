const { isTempAvatarPath, uploadAvatarToCloud } = require('../../utils/userProfile.js');
const { withRushLoading } = require('../../utils/rushLoading.js');
const { getCampusColor } = require('../../utils/campusColor.js');
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

  _timeTick: null,

  onLoad(options) {
    const rushId = options.rushId || '';
    this.setData({ rushId });
  },

  onUnload() {
    if (this._timeTick) clearInterval(this._timeTick);
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

  formatTimeUntilStart(startAt) {
    if (!startAt) return '';
    const start = new Date(startAt).getTime();
    const now = Date.now();
    const diff = start - now;
    if (diff <= 0) return '已开始';
    const totalMinutes = Math.floor(diff / 60000);
    const days = Math.floor(totalMinutes / (24 * 60));
    const remainder = totalMinutes % (24 * 60);
    const hours = Math.floor(remainder / 60);
    const minutes = remainder % 60;
    if (days >= 1) return `${days}天${hours}小时${minutes}分钟`;
    if (hours >= 1) return `${hours}小时${minutes}分钟`;
    return `${totalMinutes}分钟`;
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
      const res = await withRushLoading(() => wx.cloud.callFunction({
        name: 'court_rush_detail',
        data: { rushId: this.data.rushId, phoneNumber, clientNow: Date.now() }
      }));
      const data = res.result && res.result.data;
      if (data && data.rush) {
        const r = data.rush;
        r.time_display = this.formatRushTimeRange(r.start_at, r.end_at);
        data.timeUntilStartText = this.formatTimeUntilStart(r.start_at);
        data.campusColor = getCampusColor(r.campus);
      }
      this.setData({ detail: data });
      if (this._timeTick) clearInterval(this._timeTick);
      const startAt = data?.rush?.start_at;
      if (startAt) {
        this._timeTick = setInterval(() => {
          const text = this.formatTimeUntilStart(startAt);
          this.setData({ 'detail.timeUntilStartText': text });
          if (text === '已开始') clearInterval(this._timeTick);
        }, 60000);
      }
    } catch (err) {
      if (!err.timeout) wx.showToast({ title: '加载失败', icon: 'none' });
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
    let reloadDetail = true;
    try {
      const res = await withRushLoading(() => wx.cloud.callFunction({
        name: 'court_rush_enroll',
        data: {
          court_rush_id: this.data.rushId,
          phoneNumber: this.data.phoneNumber,
          openid,
          nonceStr: genNonce(),
          nickName,
          avatarUrl,
        }
      }), '报名中...');
      const result = res.result || {};
      if (!result.success) {
        reloadDetail = false;
        wx.showToast({ title: result.error === 'ENROLLMENT_EXPIRED' ? '报名已过期' : (result.error || '报名失败'), icon: 'none' });
        setTimeout(() => this.loadDetail(), 1500);
        return;
      }
      if (result.payment) {
        await this.requestPay(result.payment);
      }
    } catch (err) {
      if (!err.timeout) {
        reloadDetail = false;
        wx.showToast({ title: '报名失败', icon: 'none' });
        setTimeout(() => this.loadDetail(), 1500);
      }
    } finally {
      this.setData({ enrollLoading: false });
      if (reloadDetail) this.loadDetail();
    }
  },

  async continuePay() {
    const payment = this.data.detail && this.data.detail.myPayment;
    if (!payment) return;
    try {
      const query = await withRushLoading(() => wx.cloud.callFunction({
        name: 'court_rush_pay_query',
        data: { paymentId: payment._id }
      }), '加载中...');
      const result = query.result || {};
      if (!result.success) {
        wx.showToast({ title: '订单已过期', icon: 'none' });
        return;
      }
      await this.requestPay(result.order.payment_parmas || result.order.payment_params);
    } catch (err) {
      if (!err.timeout) wx.showToast({ title: '续付失败', icon: 'none' });
    } finally {
      this.loadDetail();
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

  async cancelUnpaid() {
    const enrollment = this.data.detail && this.data.detail.myEnrollment;
    if (!enrollment || enrollment.status !== 'PENDING_PAYMENT') return;
    try {
      const res = await withRushLoading(() => wx.cloud.callFunction({
        name: 'court_rush_enroll_cancel',
        data: { enrollment_id: enrollment._id, phoneNumber: this.data.phoneNumber }
      }), '取消中...');
      if (res.result && res.result.success) {
        wx.showToast({ title: '已取消报名', icon: 'success' });
      } else {
        wx.showToast({ title: (res.result && res.result.error) || '取消失败', icon: 'none' });
      }
    } catch (err) {
      if (!err.timeout) wx.showToast({ title: '取消失败', icon: 'none' });
    } finally {
      this.loadDetail();
    }
  },

  async refund() {
    const enrollment = this.data.detail && this.data.detail.myEnrollment;
    if (!enrollment) return;
    try {
      const res = await withRushLoading(() => wx.cloud.callFunction({
        name: 'court_rush_refund',
        data: {
          enrollment_id: enrollment._id,
          phoneNumber: this.data.phoneNumber,
          nonceStr: genNonce()
        }
      }), '退款中...');
      if (res.result && res.result.success) {
        wx.showToast({ title: '已发起退款', icon: 'success' });
      } else {
        wx.showToast({ title: (res.result && res.result.error) || '退款失败', icon: 'none' });
      }
    } catch (err) {
      if (!err.timeout) wx.showToast({ title: '退款失败', icon: 'none' });
    } finally {
      this.loadDetail();
    }
  },

  async cancelRush() {
    try {
      const res = await withRushLoading(() => wx.cloud.callFunction({
        name: 'court_rush_cancel',
        data: { rushId: this.data.rushId, phoneNumber: this.data.phoneNumber }
      }), '取消中...');
      if (res.result && res.result.success) {
        wx.showToast({ title: '已取消整场', icon: 'success' });
      } else {
        wx.showToast({ title: (res.result && res.result.error) || '取消失败', icon: 'none' });
      }
    } catch (err) {
      if (!err.timeout) wx.showToast({ title: '取消失败', icon: 'none' });
    } finally {
      this.loadDetail();
    }
  }
});
