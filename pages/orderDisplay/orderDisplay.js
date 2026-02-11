// pages/orderDisplay/orderDisplay.js
Page({
  data: {
    orderList: [],
    phoneNumber: '',
    pageNum: 1,
    pageSize: 20,
    hasMore: true,
    isAdmin: false,
    isSpecialManager: false,
    lastUpdateTime: 0,
    // 退款模态框相关状态
    showRefundModal: false,
    adminPassword: '',
    currentOrder: null,
    refunding: false
  },

  onLoad: function() {
    const phoneNumber = wx.getStorageSync('phoneNumber') || '';
    const app = getApp();
    const managerList = app.globalData.managerList;
    const isAdmin = managerList && managerList.includes(phoneNumber);
    
    this.setData({ 
      phoneNumber,
      isAdmin
    }, () => {
      this.checkSpecialManager();
    });
    this.startAutoRefresh();
  },

  onShow() {
    const app = getApp();
    const phoneNumber = wx.getStorageSync('phoneNumber');
    const managerList = app.globalData.managerList;
    const isAdmin = managerList && managerList.includes(phoneNumber);
    this.setData({ 
      phoneNumber: phoneNumber,
      isAdmin
    }, () => {
      this.checkSpecialManager();
    });
    this.startAutoRefresh();
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload: function() {
    const app = getApp();
    app.globalData.eventBus.emit('refreshBookingPage');
    this.stopAutoRefresh();
  },

  onPullDownRefresh: function() {
    this.setData({
      orderList: [],
      pageNum: 1,
      hasMore: true,
      lastUpdateTime: Date.now()
    }, () => {
      this.loadOrders();
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom: function() {
    if (this.data.hasMore) {
      this.setData({
        pageNum: this.data.pageNum + 1
      }, () => {
        this.loadOrders();
      });
    }
  },

  // 检查是否为特殊管理员
  checkSpecialManager: function() {
    const { phoneNumber } = this.data;
    if (!phoneNumber) return;
    
    wx.cloud.callFunction({
      name: 'special_order_list',
      data: {
        phoneNumber: phoneNumber,
        pageNum: 1,
        pageSize: 1
      }
    }).then(res => {
      const isSpecialManager = res.result.success && res.result.data.length > 0;
      this.setData({ 
        isSpecialManager,
        orderList: [],
        pageNum: 1,
        hasMore: true
      }, () => {
        this.loadOrders();
      });
    }).catch(err => {
      console.error('检查特殊管理员状态失败', err);
      this.setData({ isSpecialManager: false }, () => {
        this.loadOrders();
      });
    });
  },

  loadOrders: function() {
    const { phoneNumber, pageNum, pageSize, isSpecialManager } = this.data;
    
 
    
    wx.cloud.callFunction({
      name: 'special_order_list',
      data: {
        phoneNumber,
        pageNum,
        pageSize
      }
    }).then(res => {
      let newOrders = [];
      let hasMore = false;
      
      if (isSpecialManager) {
        // special_order_list 的返回格式
        if (res.result.success) {
          newOrders = res.result.data || [];
          hasMore = newOrders.length === pageSize;
        } else {
          console.error('特殊管理员查询失败:', res.result.message);
          wx.showToast({
            title: res.result.message || '查询失败',
            icon: 'none'
          });
        }
      } else {
        // my_order_list 的返回格式
        newOrders = res.result.data || [];
        hasMore = newOrders.length === pageSize;
      }
      
      this.setData({
        orderList: pageNum === 1 ? newOrders : [...this.data.orderList, ...newOrders],
        hasMore: hasMore,
        lastUpdateTime: Date.now()
      });
    }).catch(err => {
      console.error('加载订单失败', err);
      wx.showToast({
        title: '加载订单失败',
        icon: 'none'
      });
    });
  },

  prevPage: function() {
    if (this.data.pageNum > 1) {
      this.setData({
        pageNum: this.data.pageNum - 1
      }, () => {
        this.loadOrders();
      });
    }
  },

  nextPage: function() {
    if (this.data.hasMore) {
      this.setData({
        pageNum: this.data.pageNum + 1
      }, () => {
        this.loadOrders();
      });
    }
  },

  onOrderItemClick: function(e) {
    const order = e.currentTarget.dataset.order;
    console.log('订单详情:', order);
  },

  // 点击退款按钮
  onRefundClick: function(e) {
    // 阻止事件冒泡
    if (e && e.stopPropagation) {
      e.stopPropagation();
    }
    const order = e.currentTarget.dataset.order;
    
    if (!this.data.isAdmin) {
      wx.showToast({
        title: '只有管理员可以退款',
        icon: 'none'
      });
      return;
    }
    
    this.setData({
      showRefundModal: true,
      currentOrder: order,
      adminPassword: ''
    });
  },

  // 关闭模态框
  onCloseModal: function() {
    this.setData({
      showRefundModal: false,
      adminPassword: '',
      currentOrder: null
    });
  },

  // 点击模态框遮罩层
  onModalOverlayClick: function() {
    this.onCloseModal();
  },

  // 点击模态框内容区域（防止冒泡）
  onModalContentClick: function() {
    // 阻止冒泡，不关闭模态框
  },

  // 密码输入
  onPasswordInput: function(e) {
    this.setData({
      adminPassword: e.detail.value
    });
  },

  // 确认退款
  onConfirmRefund: function() {
    const { adminPassword, currentOrder } = this.data;
    
    if (!adminPassword.trim()) {
      wx.showToast({
        title: '请输入密码',
        icon: 'none'
      });
      return;
    }

    this.setData({ refunding: true });

    // 调用管理员退款接口
    wx.cloud.callFunction({
      name: 'admin_refund_order',
      data: {
        _id: currentOrder._id,
        total_fee: currentOrder.total_fee,
        nonceStr: Date.now().toString(),
        adminPassword: adminPassword,
        phoneNumber: this.data.phoneNumber
      }
    }).then(res => {
      console.log('管理员退款结果:', res);
      
      if (res.result.success) {
        wx.showToast({
          title: '退款申请成功',
          icon: 'success'
        });
        
        // 关闭模态框并刷新订单列表
        this.onCloseModal();
        this.refreshOrdersIncrementally();
      } else {
        wx.showToast({
          title: res.result.message || '退款失败',
          icon: 'none'
        });
      }
    }).catch(err => {
      console.error('管理员退款失败:', err);
      wx.showToast({
        title: '退款失败，请重试',
        icon: 'none'
      });
    }).finally(() => {
      this.setData({ refunding: false });
    });
  },

  startAutoRefresh: function() {
    this.stopAutoRefresh();
    this.autoRefreshTimer = setInterval(() => {
      console.log('自动刷新订单列表...');
      this.refreshOrdersIncrementally();
    }, 50000);
  },

  stopAutoRefresh: function() {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  },

  refreshOrdersIncrementally: function() {
    const now = Date.now();
    if (now - this.data.lastUpdateTime < 10000) {
      console.log('防抖：距离上次更新不足10秒，跳过自动刷新');
      return;
    }
    
    this.setData({ lastUpdateTime: now });
    
    const { phoneNumber, pageSize, isSpecialManager } = this.data;
   
    wx.cloud.callFunction({
      name: 'special_order_list' ,
      data: {
        phoneNumber,
        pageNum: 1,
        pageSize
      }
    }).then(res => {
      let newOrders = [];
      let hasMore = false;
      
      if (isSpecialManager) {
        if (res.result.success) {
          newOrders = res.result.data || [];
          hasMore = newOrders.length === pageSize;
        }
      } else {
        newOrders = res.result.data || [];
        hasMore = newOrders.length === pageSize;
      }
      
      this.setData({
        orderList: newOrders,
        hasMore: hasMore
      });
      console.log('自动刷新完成，更新了', newOrders.length, '条订单');
    }).catch(err => {
      console.error('自动刷新订单失败', err);
    });
  }
}) 