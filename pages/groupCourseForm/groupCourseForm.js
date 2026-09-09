const api = require("../../utils/groupCourseApi");
const view = require("../../utils/groupCourseView");
const PENDING_KEY = "groupCourseUnresolvedPublish";
const initialForm = {
  templateId: "",
  title: "",
  description: "",
  coachId: "",
  campus: "",
  courtId: "",
  date: "",
  startTime: "",
  endTime: "",
  priceYuan: "",
  vipPriceYuan: "",
  minParticipants: "",
  maxParticipants: "",
};
const definitiveErrors = [
  "INVALID_ARGUMENT",
  "BASE_DATA_UNAVAILABLE",
  "TEMPLATE_UNAVAILABLE",
  "COACH_UNAVAILABLE",
  "CAMPUS_UNAVAILABLE",
  "COURT_UNAVAILABLE",
  "PUBLISH_TOO_LATE",
  "INVALID_TIME_RANGE",
  "INVALID_PRICE",
  "INVALID_PARTICIPANTS",
  "COURT_CONFLICT",
  "COACH_CONFLICT",
  "FORBIDDEN",
];
function requestId() {
  return `gc_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}
function validate(form, now) {
  if (!form.templateId || !form.title.trim() || !form.description.trim())
    throw new Error("请选择教学模板，并填写标题与教学详情");
  if (!form.coachId || !form.campus || !form.courtId)
    throw new Error("请选择教练、校区和场地");
  const startAt = view.parseBeijing(form.date, form.startTime);
  const endAt = view.parseBeijing(form.date, form.endTime);
  if (
    !Number.isSafeInteger(startAt) ||
    !Number.isSafeInteger(endAt) ||
    endAt <= startAt
  )
    throw new Error("请选择同一天内有效的起止时间，须按30分钟对齐");
  if (now >= startAt - 3600000)
    throw new Error("只能在报名截止前发布，请选择1小时以后的开课时间");
  const priceYuan = Number(form.priceYuan),
    vipPriceYuan = Number(form.vipPriceYuan),
    minParticipants = Number(form.minParticipants),
    maxParticipants = Number(form.maxParticipants);
  if (!Number.isSafeInteger(priceYuan) || priceYuan < 1 || !Number.isSafeInteger(priceYuan * 100))
    throw new Error("原价须为至少1元的整数，且金额不能过大");
  if (!Number.isSafeInteger(vipPriceYuan) || vipPriceYuan < 1 || vipPriceYuan > priceYuan)
    throw new Error("请填写VIP实付金额，须为至少1元且不高于原价的整数");
  if (
    !Number.isSafeInteger(minParticipants) ||
    !Number.isSafeInteger(maxParticipants) ||
    minParticipants < 1 ||
    maxParticipants < minParticipants
  )
    throw new Error("人数须为正整数，最低人数不得超过上限");
  return {
    templateId: form.templateId,
    title: form.title.trim(),
    description: form.description.trim(),
    coachId: form.coachId,
    campus: form.campus,
    courtId: form.courtId,
    startAt,
    endAt,
    priceYuan,
    vipPriceYuan,
    minParticipants,
    maxParticipants,
  };
}
Page({
  data: {
    publishedCourseId: "",
    viewer: {},
    canManage: false,
    needsAuth: false,
    loading: false,
    submitting: false,
    unresolved: false,
    showConfirm: false,
    summary: null,
    form: Object.assign({}, initialForm),
    campuses: [],
    courts: [],
    filteredCourts: [],
    coaches: [],
    templates: [],
    templateLabel: "选择教学内容模板",
    coachLabel: "选择授课教练",
    courtLabel: "选择场地",
    error: "",
  },
  onLoad() {
    this._unwatchPermissions = api.watchPermissions(() => { this.syncPermission(); this.loadContext(); });
    // Only confirmed, dispatched and unresolved requests are retained. This is an
    // idempotency receipt, NOT an editable draft or an unpublished server record.
    const pending = wx.getStorageSync(PENDING_KEY);
    if (pending && pending.payload && pending.payload.publishRequestId) {
      this._pending = pending;
      const payload = pending.payload,
        parts = view.dateParts(payload.startAt);
      this.setData({
        unresolved: true,
        summary: pending.summary,
        form: Object.assign({}, initialForm, payload, {
          date: parts.date,
          startTime: parts.time,
          endTime: view.dateParts(payload.endAt).time,
        }),
      });
    }
  },
  onUnload() {
    if (this._unwatchPermissions) this._unwatchPermissions();
  },
  syncPermission() {
    this.setData({ canManage: api.canCreateCourse() });
  },
  onShow() {
    this.syncPermission();
    this.loadContext();
  },
  async loadContext() {
    this.setData({ loading: true });
    try {
      const context = await api.call("context");
      this.setData({
        viewer: context.viewer,
        canManage: api.canCreateCourse(),
        needsAuth: !api.hasAuth(),
        campuses: context.campuses,
        courts: context.courts,
        coaches: context.coaches,
        templates: context.templates,
      });
      this.updateLabels();
      if (context.viewer.authenticated && !api.canCreateCourse())
        this.setData({ error: "此页面仅限团课管理员使用" });
    } catch (e) {
      this.showError(e);
    } finally {
      this.setData({ loading: false });
    }
  },
  updateLabels() {
    const f = this.data.form;
    const template = this.data.templates.find(
      (item) => item.id === f.templateId,
    );
    const coach = this.data.coaches.find((item) => item.id === f.coachId);
    const court = this.data.courts.find((item) => item.id === f.courtId);
    this.setData({
      templateLabel: template ? template.title : "选择教学内容模板",
      coachLabel: coach ? coach.name : "选择授课教练",
      courtLabel: court ? view.courtLabel(court.courtNumber) : "选择场地",
      filteredCourts: this.data.courts.filter(
        (item) => item.campus === f.campus,
      ).map((item) => ({ ...item, label: view.courtLabel(item.courtNumber) })),
    });
  },
  editable() {
    return (
      !this.data.publishedCourseId &&
      !this.data.submitting &&
      !this.data.unresolved &&
      !this.data.showConfirm
    );
  },
  input(e) {
    if (!this.editable()) return;
    const field = e.currentTarget.dataset.field;
    if (!Object.prototype.hasOwnProperty.call(initialForm, field)) return;
    const form = Object.assign({}, this.data.form, { [field]: e.detail.value });
    this.setData({ form });
  },
  chooseTemplate(e) {
    if (!this.editable()) return;
    const template = this.data.templates[Number(e.detail.value)];
    if (!template) return;
    // Template ONLY fills teaching content. Schedule, price, headcount and resources stay intact.
    this.setData({
      form: Object.assign({}, this.data.form, {
        templateId: template.id,
        title: template.title,
        description: template.description,
      }),
    });
    this.updateLabels();
  },
  chooseCoach(e) {
    if (!this.editable()) return;
    const item = this.data.coaches[Number(e.detail.value)];
    if (item) {
      this.setData({
        form: Object.assign({}, this.data.form, { coachId: item.id }),
      });
      this.updateLabels();
    }
  },
  chooseCampus(e) {
    if (!this.editable()) return;
    const item = this.data.campuses[Number(e.detail.value)];
    if (item) {
      this.setData({
        form: Object.assign({}, this.data.form, {
          campus: item.name,
          courtId: "",
        }),
      });
      this.updateLabels();
    }
  },
  chooseCourt(e) {
    if (!this.editable()) return;
    const item = this.data.filteredCourts[Number(e.detail.value)];
    if (item) {
      this.setData({
        form: Object.assign({}, this.data.form, { courtId: item.id }),
      });
      this.updateLabels();
    }
  },
  preparePublish() {
    if (!this.editable() || !this.data.canManage) return;
    try {
      const payload = validate(this.data.form, api.now());
      const campus = this.data.campuses.find(
        (item) => item.name === payload.campus,
      );
      const summary = {
        title: payload.title,
        description: payload.description,
        coach: this.data.coachLabel,
        campus: payload.campus,
        court: this.data.courtLabel,
        time: `${view.dateTime(payload.startAt)}–${view.dateParts(payload.endAt).time}`,
        duration: (payload.endAt - payload.startAt) / 60000,
        price: payload.priceYuan,
        vipPrice: payload.vipPriceYuan,
        min: payload.minParticipants,
        max: payload.maxParticipants,
        deadline: view.dateTime(payload.startAt - 3600000),
        managed: !!(campus && campus.bookingManaged),
      };
      this._confirmed = { payload, summary };
      this.setData({ showConfirm: true, summary, error: "" });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  closeConfirm() {
    if (this.data.submitting || this.data.unresolved) return;
    this._confirmed = null;
    this.setData({ showConfirm: false });
  },
  swallow() {},
  async confirmPublish() {
    if (this.data.submitting || !this._confirmed || this.data.unresolved)
      return;
    this._pending = {
      payload: Object.assign({}, this._confirmed.payload, {
        publishRequestId: requestId(),
      }),
      summary: this._confirmed.summary,
      ownerPhoneNumber: this.data.viewer.phoneNumber,
    };
    // Persist before dispatch so leaving/reopening after a lost response keeps the same request.
    wx.setStorageSync(PENDING_KEY, this._pending);
    this.setData({ unresolved: true, showConfirm: false });
    await this.submitPending();
  },
  async submitPending() {
    if (this.data.submitting || !this._pending) return;
    if (
      this._pending.ownerPhoneNumber &&
      this.data.viewer.phoneNumber !== this._pending.ownerPhoneNumber
    ) {
      this.setData({
        needsAuth: !api.hasAuth(),
        error: "当前手机号与确认发布时不同，请切换回原手机号后核实发布结果",
      });
      return;
    }
    this.setData({ submitting: true, error: "" });
    try {
      const result = await api.call("publish", this._pending.payload);
      wx.removeStorageSync(PENDING_KEY);
      this._pending = null;
      this.setData({ unresolved: false, publishedCourseId: result.courseId });
      wx.redirectTo({
        url:
          "/pages/groupCourseDetail/groupCourseDetail?courseId=" +
          encodeURIComponent(result.courseId),
      });
    } catch (e) {
      if (definitiveErrors.includes(e.code)) {
        wx.removeStorageSync(PENDING_KEY);
        this._pending = null;
        this._confirmed = null;
        this.setData({ unresolved: false });
      }
      // Network/unknown errors and expired authorization retain the frozen payload and ID.
      this.showError(e);
    } finally {
      this.setData({ submitting: false });
    }
  },
  showError(e) {
    this.setData({
      error: e.message,
      needsAuth: !api.hasAuth(),
      ...(api.isAuthError(e) ? { needsAuth: !api.hasAuth(), viewer: {} } : {}),
    });
  },
  goToLogin() {
    wx.setStorageSync("postLoginRedirect", { page: "groupCourseForm", courseId: this.data.courseId || "" });
    wx.switchTab({ url: "/pages/member/member" });
  },
  async retryContext() {
    try {
      await api.refreshPermissions();
      this.syncPermission();
      await this.loadContext();
    } catch (e) { this.showError(e); }
  },
  openPublished() {
    if (this.data.publishedCourseId)
      wx.redirectTo({
        url:
          "/pages/groupCourseDetail/groupCourseDetail?courseId=" +
          encodeURIComponent(this.data.publishedCourseId),
      });
  },
});
module.exports = { validate };
