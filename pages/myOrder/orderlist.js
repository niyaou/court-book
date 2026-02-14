// pages/myOrder/orderlist.js
Page({

  /**
   * 页面的初始数据
   */
  data: {
    orderList: [],
    phoneNumber: '',
    pageNum: 1,
    pageSize: 35,
    hasMore: true,
    isAdmin: false,
    lastUpdateTime: 0, // 记录最后更新时间，用于防抖
    targetCourtId: null, // 目标场地ID，用于定位订单
    targetOrderIndex: -1 // 目标订单索引，用于高亮显示
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad: function(options) {
    const phoneNumber = wx.getStorageSync('phoneNumber') || '';
    const app = getApp();

    const managerList = app.globalData.managerList;
    const isAdmin = managerList && managerList.includes(phoneNumber);
    
    // 获取目标场地ID参数
    const targetCourtId = options.targetCourtId ? decodeURIComponent(options.targetCourtId) : null;
    
    this.setData({ 
      phoneNumber:phoneNumber,
      isAdmin,
      targetCourtId
    }, () => {
      this.loadOrders();
    });

    // 启动自动刷新定时器（每20秒刷新一次）
    this.startAutoRefresh();
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    const app = getApp();
    const phoneNumber = wx.getStorageSync('phoneNumber');
    const managerList = app.globalData.managerList;
    const isAdmin = managerList && managerList.includes(phoneNumber);
    this.setData({ 
      phoneNumber: phoneNumber,
      isAdmin
    });
    
    // 页面显示时重新启动自动刷新
    this.startAutoRefresh();
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {
    // 页面隐藏时停止自动刷新
    this.stopAutoRefresh();
  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload: function() {
    const app = getApp();
    app.globalData.eventBus.emit('refreshBookingPage');
    
    // 清除自动刷新定时器
    this.stopAutoRefresh();
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh: function() {
    // 更新最后更新时间，避免与自动刷新冲突
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

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom: function() {
    if (this.data.hasMore) {
      this.setData({
        pageNum: this.data.pageNum + 1
      }, () => {
        this.loadOrders();
      });
    }
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  },

  loadOrders: function() {
    const { phoneNumber, pageNum, pageSize } = this.data;
    Promise.all([
      wx.cloud.callFunction({
        name: 'my_order_list',
        data: { phoneNumber, pageNum, pageSize }
      }),
      wx.cloud.callFunction({
        name: 'court_rush_my_order_list',
        data: { phoneNumber, pageNum, pageSize }
      })
    ]).then(([normalRes, rushRes]) => {
      const normalOrders = (normalRes.result && normalRes.result.data) || [];
      const rushOrders = ((rushRes.result && rushRes.result.data) || []).map((o) => ({
        ...o,
        order_type: 'RUSH'
      }));

      const merged = [...normalOrders, ...rushOrders].sort((a, b) => {
        const at = new Date(a.createTime || a.created_at || 0).getTime();
        const bt = new Date(b.createTime || b.created_at || 0).getTime();
        return bt - at;
      });

      this.setData({
        orderList: pageNum === 1 ? merged : [...this.data.orderList, ...merged],
        hasMore: merged.length >= pageSize,
        lastUpdateTime: Date.now()
      }, () => {
        if (this.data.targetCourtId) {
          this.scrollToTargetOrder();
        }
      });
    }).catch(err => {
      console.error('加载订单失败', err);
    });
  },

  formatTime: function(dateString) {
    const date = new Date(dateString);
    console.log(date,dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
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

  scrollToTargetOrder: function() {
    const { targetCourtId, orderList } = this.data;
    if (!targetCourtId || !orderList || orderList.length === 0) {
      return;
    }

    // 查找包含目标场地ID的订单
    const targetOrderIndex = orderList.findIndex(order => {
      return order.court_ids && order.court_ids.includes(targetCourtId);
    });

    if (targetOrderIndex !== -1) {
      // 使用选择器定位到对应订单元素
      const query = wx.createSelectorQuery();
      query.selectAll('.order-item').boundingClientRect();
      query.exec((res) => {
        if (res && res[0] && res[0][targetOrderIndex]) {
          const targetRect = res[0][targetOrderIndex];
          // 滚动到目标位置，留出一些顶部空间
          wx.pageScrollTo({
            scrollTop: targetRect.top - 100,
            duration: 500
          });
          
          // 高亮显示目标订单
          this.setData({
            targetOrderIndex: targetOrderIndex
          });
          
          // 清除目标场地ID，避免重复定位
          this.setData({
            targetCourtId: null
          });
        }
      });
    } else if (this.data.hasMore) {
      // 如果当前页面没找到目标订单，且还有更多数据，继续加载下一页
      this.setData({
        pageNum: this.data.pageNum + 1
      }, () => {
        this.loadOrders();
      });
    }
  },

  onPayClick: function(e) {
    const order = e.currentTarget.dataset.order;
    if (order.order_type === 'RUSH') {
      wx.showLoading({ title: '验证订单中...' });
      wx.cloud.callFunction({
        name: 'court_rush_pay_query',
        data: { paymentId: order._id }
      }).then(res => {
        wx.hideLoading();
        if (!res.result.success) {
          wx.showToast({ title: '订单已过期', icon: 'none' });
          this.onPullDownRefresh();
          return;
        }
        const paymentParams = res.result.order.payment_parmas || res.result.order.payment_params;
        wx.requestPayment({
          ...paymentParams,
          success: () => {
            wx.showToast({ title: '支付成功', icon: 'success' });
            this.onPullDownRefresh();
          },
          fail: () => {
            wx.showToast({ title: '支付失败', icon: 'none' });
          }
        });
      }).catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '查询失败', icon: 'none' });
      });
      return;
    }

    if (order.payment_parmas) {
      // 付款前先查询订单是否还存在
      wx.showLoading({ title: '验证订单中...' });
      wx.cloud.callFunction({
        name: 'pay_order_query',
        data: {
          orderId: order._id
        }
      }).then(res => {
        wx.hideLoading();
        
        if (!res.result.success) {
          wx.showToast({
            title: res.result.message || '订单验证失败',
            icon: 'none'
          });
          // 刷新订单列表
          this.onPullDownRefresh();
          return;
        }
        
        // 订单验证成功，继续支付流程
        const paymentParams = res.result.order.payment_parmas;
        wx.requestPayment({
          ...paymentParams,
          success: (res) => {
            console.log('支付成功', res);
            wx.showToast({
              title: '支付成功',
              icon: 'success'
            });
            // 支付成功后刷新订单列表
            this.onPullDownRefresh();
          },
          fail: (err) => {
            console.error('支付失败', err);
            wx.showToast({
              title: '支付失败',
              icon: 'none'
            });
          }
        });
      }).catch(err => {
        wx.hideLoading();
        console.error('查询订单失败', err);
        wx.showToast({
          title: '查询订单失败',
          icon: 'none'
        });
      });
    }
  },

  onCancelClick: function(e) {
    const order = e.currentTarget.dataset.order;
    if (order.order_type === 'RUSH') {
      wx.showToast({
        title: '畅打未支付订单不可在此取消',
        icon: 'none'
      });
      return;
    }
    wx.showModal({
      title: '确认取消',
      content: '确定要取消该订单吗？',
      success: (res) => {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'cancel_order',
            data: {
              order
            }
          }).then(() => {
            wx.showToast({
              title: '取消成功',
              icon: 'success'
            });
            this.onPullDownRefresh();
          }).catch(err => {
            console.error('取消订单失败', err);
            wx.showToast({
              title: '取消失败',
              icon: 'none'
            });
          });
        }
      }
    });
  },
  // 生成随机字符串
  generateNonceStr() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const timestamp = Date.now().toString(36); // 将时间戳转换为36进制
    const randomPart = Math.random().toString(36).substring(2, 8); // 获取随机数的一部分
    result = timestamp + randomPart;
    
    // 如果长度不够32位，继续添加随机字符
    while (result.length < 32) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // 如果超过32位，截取前32位
    return result.substring(0, 32);
  },
  onRefundClick: function(e) {
    const order = e.currentTarget.dataset.order;
    if (order.order_type === 'RUSH') {
      wx.showModal({
        title: '申请退款',
        content: '确认发起畅打退款吗？',
        success: (res) => {
          if (!res.confirm) return;
          wx.showLoading({ title: '退款申请中...' });
          wx.cloud.callFunction({
            name: 'court_rush_refund',
            data: {
              enrollment_id: order.enrollment_id,
              phoneNumber: this.data.phoneNumber,
              nonceStr: this.generateNonceStr()
            }
          }).then((r) => {
            wx.hideLoading();
            if (r.result && r.result.success) {
              wx.showToast({ title: '退款申请已提交', icon: 'success' });
            } else {
              wx.showToast({ title: (r.result && r.result.error) || '申请失败', icon: 'none' });
            }
            this.onPullDownRefresh();
          }).catch(() => {
            wx.hideLoading();
            wx.showToast({ title: '申请失败', icon: 'none' });
          });
        }
      });
      return;
    }

    const nonceStr = this.generateNonceStr()
    wx.showModal({
      title: '申请退款',
      content: '确定要申请退款吗？',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '退款申请中...' });
          wx.cloud.callFunction({
            name: 'refund_order',
            data:{...order,nonceStr}
          }).then(() => {
            wx.showToast({
              title: '退款申请已提交',
              icon: 'success'
            });
            wx.hideLoading();
            setTimeout(() => {
              this.onPullDownRefresh();
            }, 8500);
          }).catch(err => {
            console.error('申请退款失败', err);
            wx.showToast({
              title: '申请失败',
              icon: 'none'
            });
            wx.hideLoading();
            setTimeout(() => {
              this.onPullDownRefresh();
            }, 1500);
          });
        }
      }
    });
  },

  startAutoRefresh: function() {
    // 防抖：如果已经有定时器在运行，先停止
    this.stopAutoRefresh();
    
    // 启动自动刷新定时器
    this.autoRefreshTimer = setInterval(() => {
      console.log('自动刷新订单列表...');
      this.refreshOrdersIncrementally();
    }, 50000); // 每30秒刷新一次
  },

  stopAutoRefresh: function() {
    // 停止自动刷新定时器
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  },

  refreshOrdersIncrementally: function() {
    // 防抖：如果距离上次更新不足10秒，则跳过
    const now = Date.now();
    if (now - this.data.lastUpdateTime < 10000) {
      console.log('防抖：距离上次更新不足10秒，跳过自动刷新');
      return;
    }
    
    // 更新最后更新时间
    this.setData({ lastUpdateTime: now });
    
    // 只刷新第一页数据，保持当前分页状态
    const { phoneNumber, pageSize } = this.data;
    this.setData({ pageNum: 1 }, () => this.loadOrders());
  }
})
