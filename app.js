const { pickStoredUserProfile } = require('./utils/userProfile.js')

App({
  globalData: {
    userInfo: null,
    userProfile: null,
    openid: null,
    managerList: [],
    specialManagerList: [],
    courtRushManagerList: [],
    accountManagerList: [],
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

  applyManagerPermissions(permissions) {
    const normalized = {
      managerList: Array.isArray(permissions && permissions.managerList) ? permissions.managerList : [],
      specialManagerList: Array.isArray(permissions && permissions.specialManagerList) ? permissions.specialManagerList : [],
      courtRushManagerList: Array.isArray(permissions && permissions.courtRushManagerList) ? permissions.courtRushManagerList : [],
      accountManagerList: Array.isArray(permissions && permissions.accountManagerList) ? permissions.accountManagerList : []
    }
    this.globalData.managerList = normalized.managerList
    this.globalData.specialManagerList = normalized.specialManagerList
    this.globalData.courtRushManagerList = normalized.courtRushManagerList
    this.globalData.accountManagerList = normalized.accountManagerList
    return normalized
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

    const storedManagerPermissions = wx.getStorageSync('managerPermissions')
    if (storedManagerPermissions) {
      const cachedPermissions = this.applyManagerPermissions(storedManagerPermissions)
      console.log('从本地存储加载管理员权限:', cachedPermissions)
    }
    wx.cloud.callFunction({
      name: 'manager_permissions',
      success: (res) => {
        if (!res.result || res.result.success === false) {
          console.error('获取管理员权限失败：', res.result && res.result.error)
          return
        }
        const managerPermissions = this.applyManagerPermissions(res.result || {})
        wx.setStorageSync('managerPermissions', managerPermissions)
        this.globalData.eventBus.emit('managerPermissionsUpdated', managerPermissions)
        console.log('获取并保存管理员权限:', managerPermissions)
      },
      fail: (err) => {
        console.error('获取管理员权限失败：', err)
      }
    })
  }
})
