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
    isManager: false,
  },

  onLoad(options) {
    const rushId = options.rushId || '';
    this.setData({ rushId });
  },

  onShow() {
    const phoneNumber = wx.getStorageSync('phoneNumber') || '';
    const app = getApp();
    const managerList = app.globalData.managerList || [];
    const specialManagerList = app.globalData.specialManagerList || [];
    const isManager = managerList.includes(phoneNumber) || specialManagerList.includes(phoneNumber);
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

  async loadDetail() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'court_rush_detail',
        data: { rushId: this.data.rushId, phoneNumber: this.data.phoneNumber }
      });
      this.setData({ detail: res.result && res.result.data });
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async enroll() {
    const openid = wx.getStorageSync('openid');
    try {
      const res = await wx.cloud.callFunction({
        name: 'court_rush_enroll',
        data: {
          court_rush_id: this.data.rushId,
          phoneNumber: this.data.phoneNumber,
          openid,
          nonceStr: genNonce(),
        }
      });
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
