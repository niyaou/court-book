// pages/monthlyRevenue/monthlyRevenue.js
Page({
  data: {
    phoneNumber: '',
    isAdmin: false,
    loading: false,
    empty: false,
    summaryList: [],
    monthTotals: [],
    grandTotal: null,
    campuses: []
  },

  onLoad: function() {
    const phoneNumber = wx.getStorageSync('phoneNumber') || '';
    const app = getApp();
    const managerList = app.globalData.managerList || [];
    const isAdmin = managerList.includes(phoneNumber);

    this.setData({
      phoneNumber,
      isAdmin
    });

    if (!phoneNumber) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    if (!isAdmin) {
      wx.showToast({ title: '仅限管理员查看', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    this.loadSummary();
  },

  onShow: function() {
    const phoneNumber = wx.getStorageSync('phoneNumber') || '';
    const app = getApp();
    const managerList = app.globalData.managerList || [];
    const isAdmin = managerList.includes(phoneNumber);

    this.setData({ phoneNumber, isAdmin });
    if (isAdmin && this.data.summaryList.length === 0 && !this.data.loading) {
      this.loadSummary();
    }
  },

  loadSummary: function() {
    const { phoneNumber } = this.data;
    if (!phoneNumber) return;

    this.setData({ loading: true, empty: false });

    wx.cloud.callFunction({
      name: 'monthly_revenue_summary',
      data: { phoneNumber },
      success: (res) => {
        this.setData({ loading: false });
        if (res.result && res.result.success) {
          const list = res.result.data || [];
          this.setData({
            summaryList: list,
            monthTotals: res.result.monthTotals || [],
            grandTotal: res.result.grandTotal || null,
            campuses: res.result.campuses || [],
            empty: list.length === 0
          });
        } else {
          const msg = res.result && res.result.message ? res.result.message : '查询失败';
          wx.showToast({ title: msg, icon: 'none' });
          this.setData({ empty: true });
        }
      },
      fail: (err) => {
        this.setData({ loading: false, empty: true });
        console.error('调用云函数失败:', err);
        wx.showToast({ title: '查询失败，请重试', icon: 'none' });
      }
    });
  },

  onPullDownRefresh: function() {
    this.loadSummary();
    setTimeout(() => wx.stopPullDownRefresh(), 800);
  }
});
