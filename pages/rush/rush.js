const { withRushLoading } = require('../../utils/rushLoading.js');
const { getCampusColorIndex } = require('../../utils/campusColor.js');
const { pickStoredUserProfile } = require('../../utils/userProfile.js');

Page({
  data: {
    list: [],
    phoneNumber: '',
    isManager: false,
    loading: false,
    page: 1
  },

  onShow() {
    const app = getApp();
    const phoneNumber = wx.getStorageSync('phoneNumber') || '';
    const storedUserProfile = wx.getStorageSync('userProfile');
    const legacyUserInfo = wx.getStorageSync('userInfo');
    const { profile } = pickStoredUserProfile({
      userProfile: app.globalData.userProfile || storedUserProfile,
      legacyUserInfo
    });
    if (!phoneNumber || !profile) {
      wx.showToast({ title: '请先完善头像和昵称', icon: 'none' });
      wx.switchTab({ url: '/pages/member/member' });
      return;
    }
    const courtRushManagerList = app.globalData.courtRushManagerList || [];
    this.setData({
      phoneNumber,
      isManager: courtRushManagerList.includes(phoneNumber)
    });
    this.loadList();
  },

  onPullDownRefresh() {
    this.loadList(1).finally(() => wx.stopPullDownRefresh());
  },

  formatRushTimeRange(startIso, endIso) {
    const fmt = (iso, withDate, withSlash) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0'); const h = String(d.getHours()).padStart(2, '0'); const min = String(d.getMinutes()).padStart(2, '0');
      if (!withDate) return `${h}:${min}`;
      return withSlash ? `${y}/${m}/${day} ${h}:${min}` : `${y}${m}${day} ${h}:${min}`;
    };
    const start = fmt(startIso, true, true);
    const end = fmt(endIso, false);
    return start && end ? `${start} - ${end}` : start || end || '';
  },

  async loadList(page) {
    const currentPage = Number(page) > 0 ? Number(page) : (this.data.page || 1);
    this.setData({ loading: true, page: currentPage });
    try {
      const res = await withRushLoading(() => wx.cloud.callFunction({
        name: 'court_rush_list',
        data: { phoneNumber: this.data.phoneNumber, page: currentPage, pageSize: 20 }
      }));
      const raw = (res.result && res.result.data) || [];
      const now = Date.now();
      const list = raw.map((item) => {
        const startAt = item.start_at ? new Date(item.start_at) : null;
        const endAt = item.end_at ? new Date(item.end_at) : null;
        const startMs = startAt && !Number.isNaN(startAt.getTime()) ? startAt.getTime() : null;
        const endMs = endAt && !Number.isNaN(endAt.getTime()) ? endAt.getTime() : null;
        const total = Number(item.current_participants || 0) + Number(item.held_participants || 0);
        const max = Number(item.max_participants || 0);
        let statusDisplay = '';
        if (item.status === 'CANCELLED' || item.deleted_at) {
          statusDisplay = '已取消';
        } else if (startMs != null && endMs != null) {
          if (now >= endMs) statusDisplay = '已结束';
          else if (now >= startMs) statusDisplay = '进行中';
          else if (max > 0 && total >= max) statusDisplay = '已满';
          else statusDisplay = '开放中';
        } else {
          statusDisplay = item.status || '';
        }
        return {
          ...item,
          time_display: this.formatRushTimeRange(item.start_at, item.end_at),
          status_display: statusDisplay,
          campusColorIndex: getCampusColorIndex(item.campus),
        };
      });
      this.setData({ list });
    } catch (err) {
      if (!err.timeout) wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  goPrevPage() {
    if (this.data.loading) return;
    const current = this.data.page || 1;
    if (current <= 1) return;
    this.loadList(current - 1);
  },

  goNextPage() {
    if (this.data.loading) return;
    if (!this.data.list || this.data.list.length < 20) return;
    const current = this.data.page || 1;
    this.loadList(current + 1);
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
