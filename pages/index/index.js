// index.js
const app = getApp()

Page({
  data: {
    userInfo: {},
    hasUserInfo: false,
    canIUse: wx.canIUse('button.open-type.getUserInfo'),
    canIUseGetUserProfile: false,
    phoneNumber: '',
    version: '', // 添加版本号
    banners: [
      { id: 1, title: '欢迎使用乐动网球' },
      { id: 2, title: '新会员优惠活动' },
      { id: 3, title: '场地预约优惠' }
    ],
    newsList: [],
    isClicking: false // 添加防抖状态
  },
  onLoad() {
    if (wx.getUserProfile) {
      this.setData({
        canIUseGetUserProfile: true
      })
    }
    this.getAnnouncements()
    this.setVersion()
  },

  // 分享给朋友
  onShareAppMessage() {
    return {
      title: '乐动网球-场地预约',
      desc: '所有校区场地都开放预约！',
      path: '/pages/index/index'
    }
  },

  // 分享到朋友圈
  onShareTimeline() {
    return {
      title: '乐动网球-场地预约',
      query: '所有校区场地都开放预约！'
    }
  },

  qiuhe(){
    wx.cloud.callFunction({
      name:"add",
      data:{
        a:1,
        b:3
      },
      success(res){
        console.log(res)
      },
      fail(err){
        console.log(err)
      }
    })
  },

  getAnnouncements() {
    wx.cloud.callFunction({
      name: 'announcement',
      success: res => {
        this.setData({
          newsList: res.result.data
        })
      },
      fail: err => {
        console.error('获取公告失败：', err)
        wx.showToast({
          title: '获取公告失败',
          icon: 'none'
        })
      }
    })
  },

  navigateToBooking: function(e) {
    // 获取校区参数
    const campus = e.currentTarget.dataset.campus || '麓坊校区';
    console.log('点击订场按钮，校区:', campus);
    
    // 将校区信息存储到全局状态中
    const app = getApp();
    app.globalData.selectedCampus = campus;
    app.globalData.needSwitchCampus = true; // 添加标记
    console.log('已设置全局校区信息:', app.globalData.selectedCampus);
    
    // 使用switchTab跳转到booking页面
    wx.switchTab({
      url: '/pages/booking/booking'
    });
  },
  navigateToMember: function() {
    wx.switchTab({
      url: '/pages/member/member'
    });
  },

  // 跳转到订单展示页面
  navigateToAbout: function() {
    console.log("navigateToAbout",this.data.isClicking)
    // 防抖处理
    if (this.data.isClicking) {
      return
    }
    
    this.setData({
      isClicking: true
    })

    // 获取用户手机号 - 使用项目中标准的获取方式
    const phoneNumber = wx.getStorageSync('phoneNumber')
    
    if (!phoneNumber) {
      this.setData({
        isClicking: false
      })
      return
    }

    // 调用权限检查云函数
    wx.cloud.callFunction({
      name: 'special_manager_check',
      data: {
        phoneNumber: phoneNumber
      },
      success: res => {
        if (res.result && res.result.success) {
          if (res.result.result === 1) {
            // 权限验证通过，跳转页面
            wx.navigateTo({
              url: '/pages/orderDisplay/orderDisplay'
            })
          } else {
            // 权限不足，不做任何响应
            console.log('权限不足，无法访问')
          }
        } else {
          console.error('权限检查失败:', res.result.error)
        }
      },
      fail: err => {
        console.error('调用权限检查云函数失败:', err)
      },
      complete: () => {
        // 立即重置防抖状态，允许下次点击
        this.setData({
          isClicking: false
        })
      }
    })
  },

  // 生成随机字符串
  generateNonceStr() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const length = 32;
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },

  // 设置版本号
  setVersion() {
    try {
      // 使用微信API获取小程序版本号
      const accountInfo = wx.getAccountInfoSync()
      console.log("-------accountInfo",accountInfo)
      const version = accountInfo.miniProgram.version || '3.1.7'
      
      this.setData({
        version: version
      })
      
      console.log('小程序版本号:', version)
    } catch (error) {
      console.error('获取版本号失败:', error)
    }
  },

  

}) 