const api = require("../../utils/groupCourseApi");
const view = require("../../utils/groupCourseView");
const confirm = (options) =>
  new Promise((resolve) =>
    wx.showModal(
      Object.assign({}, options, {
        success: (result) => resolve(result.confirm),
        fail: () => resolve(false),
      }),
    ),
  );
const acceptsPayment = (course) =>
  !!course && ["PUBLISHED", "CONFIRMED"].includes(course.status);
Page({
  data: {
    courseId: "",
    course: null,
    enrollment: null,
    payment: null,
    viewer: {},
    canManage: false,
    participants: [],
    paidParticipants: [],
    paidParticipantNextCursor: null,
    participantNextCursor: null,
    refundSummary: null,
    loading: false,
    busy: false,
    error: "",
    notice: "",
    needsAuth: false,
    holdLabel: "",
    canPay: false,
    paymentConfirmation: null,
  },
  onLoad(options) {
    this._unwatchPermissions = api.watchPermissions(() => { this.syncPermission(); this.loadDetail(); });
    this.setData({ courseId: options.courseId || "" });
  },
  syncPermission() {
    this.setData({ canManage: api.canCreateCourse() });
  },
  onShow() {
    this.syncPermission();
    this.stopTimer();
    this._visible = true;
    this.loadDetail();
    this._timer = setInterval(() => this.tick(), 1000);
  },
  onHide() {
    this.stopTimer();
  },
  onUnload() {
    this._unloaded = true;
    this.finishPaymentConfirmation(false);
    if (this._unwatchPermissions) this._unwatchPermissions();
    this.stopTimer();
  },
  stopTimer() {
    this._visible = false;
    clearInterval(this._timer);
    this._timer = null;
  },
  tick() {
    const enrollment = this.data.enrollment;
    const payment = this.data.payment;
    const now = api.now();
    const seconds = enrollment
      ? Math.max(0, Math.ceil((enrollment.holdExpiresAt - now) / 1000))
      : 0;
    this.setData({
      holdLabel: `${Math.floor(seconds / 60)}分${seconds % 60}秒`,
      canPay: !!(
        acceptsPayment(this.data.course) &&
        payment &&
        payment.expiresAt > now &&
        enrollment &&
        enrollment.status === "PENDING_PAYMENT"
      ),
    });
    if (
      this._visible &&
      acceptsPayment(this.data.course) &&
      enrollment &&
      enrollment.status === "PENDING_PAYMENT" &&
      !this.data.busy &&
      !this.data.loading &&
      now - (this._lastPoll || 0) >= 5000
    )
      this.loadDetail();
  },
  async loadDetail(append, appendPaid) {
    if (this._unloaded) return;
    if (!this.data.courseId || this.data.loading) return;
    this._lastPoll = api.now();
    this.setData({ loading: true });
    try {
      const data = await api.call("detail", {
        courseId: this.data.courseId,
        participantCursor: append ? this.data.participantNextCursor : undefined,
        participantPageSize: 20,
        paidParticipantCursor: appendPaid ? this.data.paidParticipantNextCursor : undefined,
      });
      const participants = (data.participants || []).map((p) =>
        Object.assign({}, p, {
          statusLabel: view.statuses[p.status] || p.status,
          refundLabel: view.refundStatuses[p.refundStatus] || "",
        }),
      );
      this.setData({
        course: view.course(data.course),
        notice: !acceptsPayment(data.course)
          ? data.course.status === "CANCELLED"
            ? "课程已取消，不能继续付款；如已付款，请查看本页退款进度。"
            : "课程已结束，不能继续付款。"
          : this.data.notice,
        enrollment: view.enrollment(data.myEnrollment),
        payment: data.payment,
        viewer: data.viewer,
        canManage: api.canCreateCourse(),
        needsAuth: !api.hasAuth(),
        participants: append
          ? this.data.participants.concat(participants)
          : participants,
        participantNextCursor: data.participantNextCursor || null,
        paidParticipants: appendPaid
          ? this.data.paidParticipants.concat(data.paidParticipants || [])
          : (data.paidParticipants || []),
        paidParticipantNextCursor: data.paidParticipantNextCursor || null,
        refundSummary: data.refundSummary || null,
        error: "",
      });
      this.tick();
    } catch (e) {
      this.showError(e);
    } finally {
      this.setData({ loading: false });
    }
  },
  showError(e) {
    const patch = { error: e.message, needsAuth: !api.hasAuth() };
    if (api.isAuthError(e))
      Object.assign(patch, {
        viewer: {},
        enrollment: null,
        payment: null,
        participants: [],
        refundSummary: null,
        needsAuth: !api.hasAuth(),
        canPay: false,
      });
    if (e.code === "COURSE_NOT_FOUND" || e.code === "FORBIDDEN")
      Object.assign(patch, {
        course: null,
        enrollment: null,
        payment: null,
        participants: [],
        paidParticipants: [],
        paidParticipantNextCursor: null,
        refundSummary: null,
      });
    this.setData(patch);
  },
  goToLogin() {
    wx.setStorageSync("postLoginRedirect", { page: "groupCourseDetail", courseId: this.data.courseId || "" });
    wx.switchTab({ url: "/pages/member/member" });
  },
  confirmPayment(options) {
    const c = this.data.course;
    return new Promise((resolve) => {
      this._paymentConfirmationResolve = resolve;
      this.setData({ paymentConfirmation: {
        ...options,
        courseTitle: c.title,
        time: c.timeLabel,
        campus: c.campus,
        court: c.courtLabel,
      } });
    });
  },
  finishPaymentConfirmation(accepted) {
    const resolve = this._paymentConfirmationResolve;
    if (!resolve) return;
    this._paymentConfirmationResolve = null;
    if (!this._unloaded) this.setData({ paymentConfirmation: null });
    resolve(accepted);
  },
  acceptPaymentConfirmation() {
    this.finishPaymentConfirmation(true);
  },
  dismissPaymentConfirmation() {
    this.finishPaymentConfirmation(false);
  },
  preventBackgroundScroll() {},
  async enroll() {
    // Match rush enrollment: reuse global profile; complete missing data in member center.
    if (!api.hasAuth() || !api.hasProfile()) { this.goToLogin(); return; }
    if (this.data.busy || !this.data.course || !this.data.course.canEnroll)
      return;
    this.setData({ busy: true, error: "", notice: "" });
    try {
      const c = this.data.course;
      const accepted = await this.confirmPayment({
        title: "确认报名", amount: c.actualFeeYuan, isVip: c.isVip,
        confirmText: "确认报名",
      });
      if (!accepted) return;
      const result = await api.call("enroll", { courseId: this.data.courseId });
      this.setData({
        enrollment: view.enrollment(result.enrollment),
        payment: result.payment,
      });
      if (result.enrollment.actualFeeYuan !== c.actualFeeYuan) {
        const acceptPrice = await this.confirmPayment({
          title: "报名价格已更新", amount: result.enrollment.actualFeeYuan,
          isVip: result.enrollment.isVip, confirmText: "继续支付",
          priceUpdated: true,
        });
        if (!acceptPrice) return;
      }
      await this.pay(result.payment);
    } catch (e) {
      this.showError(e);
    } finally {
      const error = this.data.error;
      if (!this._unloaded) this.setData({ busy: false });
      await this.loadDetail();
      if (error && !this._unloaded) this.setData({ error });
    }
  },
  async pay(payment) {
    // A stale DTO/payment object must never reopen payment on a terminal course.
    if (!acceptsPayment(this.data.course)) {
      this.setData({
        canPay: false,
        notice: "课程已取消或结束，不能继续付款。",
      });
      return;
    }
    if (!payment || payment.expiresAt <= api.now()) {
      this.setData({ notice: "支付窗口已结束，正在等待系统确认报名结果。" });
      return;
    }
    try {
      await new Promise((resolve, reject) =>
        wx.requestPayment(
          Object.assign({}, payment.paymentParams, {
            success: resolve,
            fail: reject,
          }),
        ),
      );
      this.setData({
        notice: "支付操作已完成，正在确认报名结果。请以页面报名状态为准。",
      });
    } catch (e) {
      this.setData({
        notice: /cancel/i.test(e.errMsg || "")
          ? "你已退出支付，可在支付窗口内继续付款。"
          : "支付结果尚未确认，请刷新查看报名状态。",
      });
    }
  },
  async continuePayment() {
    if (this.data.busy || !acceptsPayment(this.data.course)) return;
    this.setData({ busy: true });
    try {
      await this.loadDetail();
      if (
        acceptsPayment(this.data.course) &&
        this.data.enrollment &&
        this.data.enrollment.status === "PENDING_PAYMENT" &&
        this.data.payment && this.data.payment.expiresAt > api.now()
      ) {
        const accepted = await this.confirmPayment({
          title: "确认继续付款", amount: this.data.enrollment.actualFeeYuan,
          isVip: this.data.enrollment.isVip, confirmText: "继续支付",
        });
        if (accepted) await this.pay(this.data.payment);
      }
    } catch (e) {
      this.showError(e);
    } finally {
      const error = this.data.error;
      if (!this._unloaded) this.setData({ busy: false });
      await this.loadDetail();
      if (error && !this._unloaded) this.setData({ error });
    }
  },
  async cancelEnrollment() {
    if (
      this.data.busy ||
      !this.data.enrollment ||
      !this.data.enrollment.canCancel
    )
      return;
    this.setData({ busy: true });
    try {
      if (
        !(await confirm({
          title: "取消报名",
          content: `将按实付金额 ¥${this.data.enrollment.actualFeeYuan} 发起全额原路退款，到账进度可在本页查看。`,
          confirmText: "确认取消",
        }))
      )
        return;
      await api.call("cancelEnrollment", { courseId: this.data.courseId });
      this.setData({ notice: "取消申请已提交，退款自动处理中。" });
    } catch (e) {
      this.showError(e);
    } finally {
      const error = this.data.error;
      if (!this._unloaded) this.setData({ busy: false });
      await this.loadDetail();
      if (error && !this._unloaded) this.setData({ error });
    }
  },
  async cancelCourse() {
    if (this.data.busy || !this.data.canManage) return;
    this.setData({ busy: true });
    try {
      if (
        !(await confirm({
          title: "整体取消课程",
          content:
            "取消后立即停止报名并释放场地，已支付报名将自动逐笔退款。课程不可恢复；需要变更请重新发布。",
          confirmText: "确认取消",
          confirmColor: "#bf4650",
        }))
      )
        return;
      await api.call("cancelCourse", { courseId: this.data.courseId });
      this.setData({ notice: "课程已取消，退款自动处理中。" });
    } catch (e) {
      this.showError(e);
    } finally {
      const error = this.data.error;
      if (!this._unloaded) this.setData({ busy: false });
      await this.loadDetail();
      if (error && !this._unloaded) this.setData({ error });
    }
  },
  loadParticipants() {
    if (this.data.participantNextCursor) this.loadDetail(true);
  },
  loadPaidParticipants() {
    if (this.data.paidParticipantNextCursor) this.loadDetail(false, true);
  },
  participantAvatarError(e) {
    const field = e.currentTarget.dataset.group === "admin" ? "participants" : "paidParticipants";
    const id = e.currentTarget.dataset.id;
    this.setData({ [field]: this.data[field].map((p) => p.id === id ? { ...p, avatarUrl: "" } : p) });
  },
  refresh() {
    this.loadDetail();
  },
  onShareAppMessage() {
    return {
      title: this.data.course ? this.data.course.title : "乐动网球 · 公开团课",
      path:
        "/pages/groupCourseDetail/groupCourseDetail?courseId=" +
        encodeURIComponent(this.data.courseId),
    };
  },
});
