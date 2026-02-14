Page({
  data: {
    list: [],
    phoneNumber: '',
    isManager: false,
    loading: false
  },

  onShow() {
    const phoneNumber = wx.getStorageSync('phoneNumber') || '';
    const app = getApp();
    const managerList = app.globalData.managerList || [];
    const specialManagerList = app.globalData.specialManagerList || [];
    this.setData({
      phoneNumber,
      isManager: managerList.includes(phoneNumber) || specialManagerList.includes(phoneNumber)
    });
    this.loadList();
  },

  onPullDownRefresh() {
    this.loadList().finally(() => wx.stopPullDownRefresh());
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'court_rush_list',
        data: { phoneNumber: this.data.phoneNumber }
      });
      this.setData({ list: (res.result && res.result.data) || [] });
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  openDetail(e) {
    const rushId = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/rushDetail/rushDetail?rushId=${rushId}` });
  },

  onShareAppMessage() {
    return {
      title: '畅打活动',
      path: '/pages/rush/rush'
    };
  }
});
