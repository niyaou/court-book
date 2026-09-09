const api = require("../../utils/groupCourseApi");
const view = require("../../utils/groupCourseView");
Page({
  data: {
    scope: "public",
    campuses: [],
    campus: "",
    items: [],
    viewer: {},
    canCreate: false,
    loading: false,
    error: "",
    nextCursor: null,
    needsAuth: false,
  },
  onLoad() {
    this._seq = 0;
    const app = typeof getApp === "function" ? getApp() : null;
    this._permissionBus = app && app.globalData && app.globalData.eventBus;
    this._permissionUpdated = () => this.syncCreatePermission();
    if (this._permissionBus) this._permissionBus.on("managerPermissionsUpdated", this._permissionUpdated);
  },
  onShow() {
    this.syncCreatePermission();
    this.refresh();
  },
  onUnload() {
    if (this._permissionBus) this._permissionBus.off("managerPermissionsUpdated", this._permissionUpdated);
    ++this._refreshId;
    ++this._seq;
  },
  syncCreatePermission() {
    this.setData({ canCreate: api.canCreateCourse() });
  },
  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },
  onReachBottom() {
    if (this.data.nextCursor && !this.data.loading) this.loadList(true);
  },
  async refresh() {
    const refreshId = this._refreshId = (this._refreshId || 0) + 1;
    ++this._seq;
    this.setData({ needsAuth: !api.hasAuth(), error: "" });
    try {
      const context = await api.call("context");
      if (refreshId !== this._refreshId) return;
      this.setData({
        viewer: context.viewer,
        canCreate: api.canCreateCourse(),
        campuses: context.campuses,
        needsAuth: !api.hasAuth(),
      });
      await this.loadList(false);
    } catch (e) {
      if (refreshId === this._refreshId) this.showError(e);
    }
  },
  async loadList(append) {
    const seq = ++this._seq;
    if (this.data.scope === "mine" && !api.hasAuth()) {
      this.setData({
        needsAuth: true,
        items: [],
        nextCursor: null,
        loading: false,
      });
      return;
    }
    this.setData({ loading: true, error: "", needsAuth: !api.hasAuth() });
    try {
      const data = await api.call("list", {
        scope: this.data.scope,
        campus: this.data.campus || undefined,
        cursor: append ? this.data.nextCursor : undefined,
        pageSize: 20,
      });
      if (seq !== this._seq) return;
      const items = data.items.map(view.item);
      this.setData({
        items: append ? this.data.items.concat(items) : items,
        viewer: data.viewer,
        canCreate: api.canCreateCourse(),
        needsAuth: !api.hasAuth(),
        nextCursor: data.nextCursor,
      });
    } catch (e) {
      if (seq === this._seq) this.showError(e);
    } finally {
      if (seq === this._seq) this.setData({ loading: false });
    }
  },
  showError(e) {
    this.setData({
      error: e.message,
      needsAuth: !api.hasAuth(),
      ...(api.isAuthError(e)
        ? { viewer: {}, items: [], nextCursor: null }
        : {}),
    });
  },
  switchScope(e) {
    const scope = e.currentTarget.dataset.scope;
    if (scope === this.data.scope) return;
    this.setData({ scope, items: [], nextCursor: null });
    this.loadList(false);
  },
  selectCampus(e) {
    this.setData({
      campus: e.currentTarget.dataset.campus || "",
      items: [],
      nextCursor: null,
    });
    this.loadList(false);
  },
  goToLogin() {
    wx.setStorageSync("postLoginRedirect", { page: "groupCourse" });
    wx.switchTab({ url: "/pages/member/member" });
  },
  openDetail(e) {
    wx.navigateTo({
      url:
        "/pages/groupCourseDetail/groupCourseDetail?courseId=" +
        encodeURIComponent(e.currentTarget.dataset.id),
    });
  },
  createCourse() {
    wx.navigateTo({ url: "/pages/groupCourseForm/groupCourseForm" });
  },
  loadMore() {
    if (this.data.nextCursor && !this.data.loading) this.loadList(true);
  },
  retry() {
    this.refresh();
  },
  onShareAppMessage() {
    return {
      title: "乐动网球 · 公开团课",
      path: "/pages/groupCourse/groupCourse",
    };
  },
});
