const { pickStoredUserProfile } = require('./utils/userProfile.js')

App({
  globalData: {
    userInfo: null,
    userProfile: null,
    openid: null,
    managerList: [],
    specialManagerList: [],
    courtRushManagerList: [],
    eventBus: {
      listeners: {},
      on(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = []
        this.listeners[event].push(callback)
      },
      emit(event, data) {
        if (this.listeners[event]) this.listeners[event].forEach((callback) => callback(data))
      },
      off(event, callback) {
        if (!this.listeners[event]) return
        if (callback) {
          this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback)
        } else {
          delete this.listeners[event]
        }
      }
    }
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }

    wx.cloud.init({
      env: 'cloud1-6gebob4m4ba8f3de',
      traceUser: true
    })

    const storedUserProfile = wx.getStorageSync('userProfile')
    const legacyUserInfo = wx.getStorageSync('userInfo')
    const { profile, source } = pickStoredUserProfile({
      userProfile: storedUserProfile,
      legacyUserInfo
    })
    if (profile) {
      this.globalData.userProfile = profile
      this.globalData.userInfo = profile
      if (source === 'legacyUserInfo') wx.setStorageSync('userProfile', profile)
    }

    const openid = wx.getStorageSync('openid')
    if (openid) {
      this.globalData.openid = openid
      console.log('从本地存储加载 openid:', openid)
    } else {
      wx.cloud.callFunction({
        name: 'getopenId',
        success: (res) => {
          const id = res.result.openid
          wx.setStorageSync('openid', id)
          this.globalData.openid = id
          console.log('获取并保存 openid:', id)
        },
        fail: (err) => {
          console.error('获取 openid 失败：', err)
        }
      })
    }

    const managerList = wx.getStorageSync('managerList')
    if (managerList) {
      this.globalData.managerList = managerList
      console.log('从本地存储加载管理员列表:', managerList)
    }
    wx.cloud.callFunction({
      name: 'manager_list',
      success: (res) => {
        const newManagerList = res.result || []
        wx.setStorageSync('managerList', newManagerList)
        this.globalData.managerList = newManagerList
        console.log('获取并保存管理员列表:', newManagerList)
      },
      fail: (err) => {
        console.error('获取管理员列表失败：', err)
      }
    })

    const specialManagerList = wx.getStorageSync('specialManagerList')
    if (specialManagerList) {
      this.globalData.specialManagerList = specialManagerList
      console.log('从本地存储加载特殊管理员列表:', specialManagerList)
    }
    wx.cloud.callFunction({
      name: 'special_manager',
      success: (res) => {
        const newSpecialManagerList = res.result || []
        wx.setStorageSync('specialManagerList', newSpecialManagerList)
        this.globalData.specialManagerList = newSpecialManagerList
        console.log('获取并保存特殊管理员列表:', newSpecialManagerList)
      },
      fail: (err) => {
        console.error('获取特殊管理员列表失败：', err)
      }
    })

    const courtRushManagerList = wx.getStorageSync('courtRushManagerList')
    if (courtRushManagerList) {
      this.globalData.courtRushManagerList = courtRushManagerList
      console.log('从本地存储加载畅打管理员列表:', courtRushManagerList)
    }
    wx.cloud.callFunction({
      name: 'court_rush_manager',
      success: (res) => {
        const newCourtRushManagerList = res.result || []
        wx.setStorageSync('courtRushManagerList', newCourtRushManagerList)
        this.globalData.courtRushManagerList = newCourtRushManagerList
        console.log('获取并保存畅打管理员列表:', newCourtRushManagerList)
      },
      fail: (err) => {
        console.error('获取畅打管理员列表失败：', err)
      }
    })
  }
})
