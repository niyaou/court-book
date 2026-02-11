// pages/chargedList/chargedList.js
Page({
  data: {
    chargedList: [],
    phoneNumber: '',
    loading: false,
    empty: false,
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0
  },

  onLoad: function() {
    const phoneNumber = wx.getStorageSync('phoneNumber');
    //  const phoneNumber = "18708162730"
    if (phoneNumber) {
      this.setData({ phoneNumber });
      this.loadChargedList(1);
    } else {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    }
  },

  loadChargedList: function(page = 1) {
    const { phoneNumber, pageSize = 20 } = this.data;
    if (!phoneNumber) {
      return;
    }

    const currentPage = page || 1;
    const currentPageSize = pageSize || 20;
    
    this.setData({ 
      loading: true, 
      empty: false,
      page: currentPage
    });

    wx.cloud.callFunction({
      name: 'charged_list',
      data: {
        phoneNumber: phoneNumber,
        page: currentPage,
        pageSize: currentPageSize
      },
      success: (res) => {
        this.setData({ loading: false });
        
        if (res.result && res.result.success) {
          const list = res.result.data || [];
          const total = res.result.total || 0;
          const totalPages = Math.ceil(total / currentPageSize);
          
          this.setData({
            chargedList: list,
            empty: list.length === 0,
            page: res.result.page,
            total: total,
            totalPages: totalPages
          });
        } else {
          this.setData({ 
            chargedList: [],
            empty: true,
            total: 0,
            totalPages: 0
          });
          if (res.result && res.result.message) {
            console.log('查询充值记录失败:', res.result.message);
          }
        }
      },
      fail: (err) => {
        this.setData({ 
          loading: false,
          chargedList: [],
          empty: true
        });
        console.error('查询充值记录失败:', err);
        wx.showToast({
          title: '查询失败',
          icon: 'none'
        });
      }
    });
  },

  goToPrevPage: function() {
    const { page } = this.data;
    if (page > 1) {
      this.loadChargedList(page - 1);
    }
  },

  goToNextPage: function() {
    const { page, totalPages } = this.data;
    if (page < totalPages) {
      this.loadChargedList(page + 1);
    }
  },

  onPullDownRefresh: function() {
    this.loadChargedList(1);
    setTimeout(() => {
      wx.stopPullDownRefresh();
    }, 1000);
  }
});

