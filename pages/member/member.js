Page({
  data: {
    userInfo: {
      nickName: '',
      avatarUrl: '',
      memberLevel: '',
      memberCardNo: '',
      points: 0,
      expireDate: ''
    },
    showAddCourtModal: false,
    campus: '',
    courtNumber: '',
    phoneNumber: '',
    maskedPhoneNumber: '',
    orders: [],
    memberInfo: null,
    loading: false
  },

  maskPhoneNumber: function(phoneNumber) {
    if (!phoneNumber || phoneNumber.length !== 11) return phoneNumber || '';
    return phoneNumber.substr(0, 3) + '****' + phoneNumber.substr(7);
  },

  onLoad: function() {
    // 检查本地存储中是否有用户信息
    const phoneNumber = wx.getStorageSync('phoneNumber');
    if (phoneNumber) {
      this.setData({ 
        phoneNumber,
        maskedPhoneNumber: this.maskPhoneNumber(phoneNumber)
      });
      this.getMemberInfo();
    }
  },
  onShow: function() {
    // Read phone number from storage every time page is shown
    const phoneNumber = wx.getStorageSync('phoneNumber');
    this.setData({ 
      phoneNumber: phoneNumber,
      maskedPhoneNumber: this.maskPhoneNumber(phoneNumber)
    });
    if (phoneNumber) {
      this.getMemberInfo();
    }
  },
  getUserProfile: function() {
    wx.getUserProfile({
      desc: '用于完善会员资料',
      success: (res) => {
        const userInfo = res.userInfo;
        // 这里可以添加注册会员的逻辑
        this.setData({ userInfo });
        wx.setStorageSync('userInfo', userInfo);
      },
      fail: (err) => {
        console.error('获取用户信息失败', err);
      }
    });
  },

  navigateToMyBookings: function() {
    wx.navigateTo({
      url: '/pages/myOrder/orderlist'
    });
  },

  navigateToChargedList: function() {
    wx.navigateTo({
      url: '/pages/chargedList/chargedList'
    });
  },

  navigateToSpendList: function() {
    wx.navigateTo({
      url: '/pages/spendList/spendList'
    });
  },

  navigateToPoints: function() {
    wx.navigateTo({
      url: '/pages/points/points'
    });
  },

  navigateToSettings: function() {
    wx.navigateTo({
      url: '/pages/settings/settings'
    });
  },

  showAddCourtModal: function() {
    this.setData({ showAddCourtModal: true });
  },

  handleModalCancel: function() {
    this.setData({ showAddCourtModal: false, campus: '', courtNumber: '' });
  },

  onCampusInput: function(e) {
    this.setData({ campus: e.detail.value });
  },

  onCourtNumberInput: function(e) {
    this.setData({ courtNumber: e.detail.value });
  },

  handleModalConfirm: function() {
    const { campus, courtNumber } = this.data;
    if (!campus || !courtNumber) {
      wx.showToast({ title: '请填写完整信息', icon: 'none' });
      return;
    }
    wx.cloud.callFunction({
      name: 'add_court',
      data: { campus, courtNumber },
      success: (res) => {
        if (res.result && res.result.success) {
          wx.showToast({ title: '添加成功', icon: 'success' });
          this.setData({ showAddCourtModal: false, campus: '', courtNumber: '' });
        } else {
          wx.showToast({ title: res.result.error || '添加失败', icon: 'none' });
        }
      },
      fail: (err) => {
        wx.showToast({ title: '网络错误', icon: 'none' });
      }
    });
  },
  getOpenId(){
    wx.cloud.callFunction({
      name:"getopenId",
      success(res){
        console.log(res)
      },
      fail(err){
        console.log(err)
      }
    })
  },
  async getPhoneNumber(e) {
    await this.getOpenId()
    if (e.detail.errMsg === 'getPhoneNumber:ok') {
      // 用户同意授权，获取加密数据和iv
      console.log('==== e.detail=', e.detail)
      const { encryptedData, iv,code } = e.detail;
      // 这里可以调用云函数或后端接口解密手机号
      wx.cloud.callFunction({
        name: 'baseNumber',
        data: {
          encryptedData,
          iv,
          code
        },
        success: res => {
          console.log('resutl',res.result)
          if (res.result && res.result.errCode===0) {
            this.setData({
              phoneNumber: res.result.phoneInfo.phoneNumber,
              maskedPhoneNumber: this.maskPhoneNumber(res.result.phoneInfo.phoneNumber)
            });
            wx.setStorageSync('phoneNumber', res.result.phoneInfo.phoneNumber);
            wx.showToast({
              title: '获取手机号成功',
              icon: 'success'
            });
            console.log('手机号:',  res.result.phoneInfo.phoneNumber);
            // 获取手机号成功后，查询会员信息
            this.getMemberInfo();
          } else {
            wx.showToast({
              title: '获取手机号失败',
              icon: 'error'
            });
            console.error('获取手机号失败', res.result ? res.result.error : res);
          }
        },
        fail: err => {
          wx.showToast({
            title: '云函数调用失败',
            icon: 'error'
          });
          console.error('云函数调用失败', err);
        }
      });
    } else {
      // 用户拒绝授权
      wx.showToast({
        title: '您拒绝了授权',
        icon: 'none'
      });
      console.warn('用户拒绝授权手机号');
    }
  },
  // 查询会员信息
  getMemberInfo: function() {
    const { phoneNumber } = this.data;
    if (!phoneNumber) {
      return;
    }

    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'club_member',
      data: {
        phoneNumber: phoneNumber
      },
      success: (res) => {
        this.setData({ loading: false });
        if (res.result && res.result.success) {
          this.setData({
            memberInfo: res.result.data
          });
        } else {
          this.setData({ memberInfo: null });
          if (res.result && res.result.message) {
            console.log('查询会员信息失败:', res.result.message);
          }
        }
      },
      fail: (err) => {
        this.setData({ loading: false, memberInfo: null });
        console.error('查询会员信息失败:', err);
      }
    });
  },
}); 