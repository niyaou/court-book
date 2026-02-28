Page({
  data: {
    list: [],
    phoneNumber: '',
    isManager: false,
    loading: false
  },

  onShow() {
    const phoneNumber = wx.getStorageSync('phoneNumber') || '';
    const app = getApp();
    const courtRushManagerList = app.globalData.courtRushManagerList || [];
    this.setData({
      phoneNumber,
      isManager: courtRushManagerList.includes(phoneNumber)
    });
    this.loadList();
  },

  onPullDownRefresh() {
    this.loadList().finally(() => wx.stopPullDownRefresh());
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

  async loadList() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'court_rush_list',
        data: { phoneNumber: this.data.phoneNumber }
      });
      const raw = (res.result && res.result.data) || [];
      const statusText = { OPEN: '开放中', FULL: '已满', ENDED: '已结束', CANCELLED: '已取消' };
      const list = raw.map((item) => ({
        ...item,
        time_display: this.formatRushTimeRange(item.start_at, item.end_at),
        status_display: statusText[item.status] || item.status,
      }));
      this.setData({ list });
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
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
