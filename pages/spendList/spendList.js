// pages/spendList/spendList.js
Page({
  data: {
    spendList: [],
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
    // const phoneNumber = "18708162730"
    if (phoneNumber) {
      this.setData({ phoneNumber });
      this.loadSpendList(1);
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

  // 课程类型映射
  getCourseTypeName: function(courseType) {
    const typeMap = {
      '-2': '体验课未成单',
      '-1': '体验课成单',
      '0': '订场',
      '1': '班课',
      '2': '私教'
    };
    return typeMap[String(courseType)] || '未知类型';
  },

  loadSpendList: function(page = 1) {
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
      name: 'spend_list',
      data: {
        phoneNumber: phoneNumber,
        page: currentPage,
        pageSize: currentPageSize
      },
      success: (res) => {
        this.setData({ loading: false });
        
        if (res.result && res.result.success) {
          // 处理数据，添加课程类型映射
          const newList = (res.result.data || []).map(item => {
            return {
              ...item,
              course_type_name: this.getCourseTypeName(item.course_type)
            };
          });
          const total = res.result.total || 0;
          const totalPages = Math.ceil(total / currentPageSize);
          
          this.setData({
            spendList: newList,
            empty: newList.length === 0,
            page: res.result.page,
            total: total,
            totalPages: totalPages
          });
        } else {
          this.setData({ 
            spendList: [],
            empty: true,
            total: 0,
            totalPages: 0
          });
          if (res.result && res.result.message) {
            console.log('查询消费记录失败:', res.result.message);
          }
        }
      },
      fail: (err) => {
        this.setData({ 
          loading: false,
          spendList: [],
          empty: true
        });
        console.error('查询消费记录失败:', err);
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
      this.loadSpendList(page - 1);
    }
  },

  goToNextPage: function() {
    const { page, totalPages } = this.data;
    if (page < totalPages) {
      this.loadSpendList(page + 1);
    }
  },

  onPullDownRefresh: function() {
    this.loadSpendList(1);
    setTimeout(() => {
      wx.stopPullDownRefresh();
    }, 1000);
  }
});

