const app = getApp()
const { COURSE, RECHARGE_NOTICE, mergeSubmissions, rechargeSubmission } = require('./submissions')

const typeLabel = { '-2': '体验课未成单', '-1': '体验课成单', 0: '订场', 1: '班课', 2: '私教' }
function decorateCourse(course) {
  return {
    ...course,
    coachName: course.coachName || ((app.globalData.coachContext.coach || {}).name || ''),
    typeLabel: typeLabel[course.courseType] || '未知课程',
    adultLabel: Number(course.courseType) === 0 ? '' : (Number(course.isAdult) === 1 ? '成人' : '儿童')
  }
}
function toast(title) { wx.showToast({ title, icon: 'none' }) }
function emptyCurrentMonthSummary() {
  return { month: '', monthLabel: '本月', totalCourses: 0, totalDuration: 0, equivalentTotalPeople: 0 }
}
function decorateCurrentMonthSummary(summary) {
  if (!summary || !/^\d{4}-\d{2}$/.test(summary.month || '')) return emptyCurrentMonthSummary()
  const [year, month] = summary.month.split('-').map(Number)
  return {
    month: summary.month,
    monthLabel: `${year}年${month}月`,
    totalCourses: Number(summary.totalCourses) || 0,
    totalDuration: Number(summary.totalDuration) || 0,
    equivalentTotalPeople: Number(summary.equivalentTotalPeople) || 0
  }
}

Page({
  data: {
    activeTab: 'pending',
    pendingList: [], pendingLoading: false, pendingLoaded: false, pendingError: '', pendingCollapsed: {},
    formalList: [], formalLoading: false, formalLoaded: false, formalPage: 1, formalPageInput: '1', formalTotal: 0, formalTotalPages: 0, formalCollapsed: {},
    acknowledgedList: [], acknowledgedLoading: false, acknowledgedLoaded: false, acknowledgedPage: 1, acknowledgedPageInput: '1', acknowledgedTotal: 0, acknowledgedTotalPages: 0,
    currentMonthSummary: emptyCurrentMonthSummary(),
    COURSE, RECHARGE_NOTICE
  },

  async onLoad() {
    const context = await app.ensureCoachContext(wx.getStorageSync('phoneNumber'))
    if (!context.isCoach) return this.leaveSilently()
    this.ready = true
    this.loadPending()
  },

  onShow() {
    if (!this.ready) return
    if (this.data.activeTab === 'pending') this.loadPending()
    if (this.data.activeTab === 'acknowledged') this.loadAcknowledged(this.data.acknowledgedPage)
  },
  onUnload() { this.ready = false },

  leaveSilently() {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/member/member' })
  },

  async call(name, data) {
    const result = await new Promise((resolve, reject) => wx.cloud.callFunction({ name, data, success: res => resolve(res.result), fail: reject }))
    if (result && result.code === 'UNAUTHORIZED_CONTEXT') {
      app.globalData.coachContextPromise = null
      const context = await app.ensureCoachContext(wx.getStorageSync('phoneNumber'), true)
      if (!context.isCoach) this.leaveSilently()
    }
    return result
  },

  mergePending() {
    this.setData({ pendingList: mergeSubmissions(this.pendingCourses || [], this.pendingNotices || []) })
  },

  async loadPending() {
    if (this.pendingLoading) return
    this.pendingLoading = true
    this.setData({ pendingLoading: true })
    const seq = (this.pendingSeq || 0) + 1
    this.pendingSeq = seq
    const coachId = app.globalData.coachContext.coach.id
    const courseTask = this.call('pending_course', { action: 'list', coachId })
      .then(result => {
        if (!result || !result.success) throw new Error((result && result.message) || '待审课程加载失败')
        return { kind: 'course', data: (result.data || []).map(decorateCourse) }
      })
    const noticeTask = this.call('recharge_notice', { action: 'list', coachId, status: 'PENDING', page: 1 })
      .then(result => {
        if (!result || !result.success) throw new Error((result && result.message) || '充值待办加载失败')
        return { kind: 'notice', data: result.data || [] }
      })
    const results = await Promise.allSettled([courseTask, noticeTask])
    if (seq !== this.pendingSeq) return
    const errors = []
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value.kind === 'course') this.pendingCourses = result.value.data
        else this.pendingNotices = result.value.data
      } else {
        console.error(result.reason)
        errors.push(index === 0 ? '待审课程加载失败' : '充值待办加载失败')
      }
    })
    this.mergePending()
    this.setData({ pendingLoaded: true, pendingError: errors.join('；') })
    if (errors.length) toast(errors.join('；'))
    if (seq === this.pendingSeq) this.setData({ pendingLoading: false })
    this.pendingLoading = false
  },

  async loadFormal(page = this.data.formalPage) {
    if (this.formalLoading) return
    this.formalLoading = true
    this.setData({ formalLoading: true })
    const seq = (this.formalSeq || 0) + 1
    this.formalSeq = seq
    try {
      const result = await this.call('coach_course_list', { coachId: app.globalData.coachContext.coach.id, page })
      if (seq !== this.formalSeq) return
      if (result && result.success) {
        this.setData({ formalList: (result.data || []).map(decorateCourse), formalLoaded: true, formalPage: result.page, formalPageInput: String(result.page), formalTotal: result.total, formalTotalPages: result.totalPages, currentMonthSummary: decorateCurrentMonthSummary(result.currentMonthSummary) })
        wx.pageScrollTo({ scrollTop: 0, duration: 0 })
      } else if (result) toast(result.message || '正式课加载失败')
    } catch (error) { console.error(error); toast('正式课加载失败') }
    finally { if (seq === this.formalSeq) this.setData({ formalLoading: false }); this.formalLoading = false }
  },

  async loadAcknowledged(page = this.data.acknowledgedPage) {
    if (this.acknowledgedLoading) return
    this.acknowledgedLoading = true
    this.setData({ acknowledgedLoading: true })
    const seq = (this.acknowledgedSeq || 0) + 1
    this.acknowledgedSeq = seq
    try {
      const result = await this.call('recharge_notice', { action: 'list', coachId: app.globalData.coachContext.coach.id, status: 'ACKNOWLEDGED', page })
      if (seq !== this.acknowledgedSeq) return
      if (result && result.success) {
        const actualPage = Number(result.page || Number(result.number) + 1 || 1)
        this.setData({
          acknowledgedList: (result.data || []).map(rechargeSubmission), acknowledgedLoaded: true,
          acknowledgedPage: actualPage, acknowledgedPageInput: String(actualPage),
          acknowledgedTotal: Number(result.total) || 0, acknowledgedTotalPages: Number(result.totalPages) || 0
        })
        wx.pageScrollTo({ scrollTop: 0, duration: 0 })
      } else if (result) toast(result.message || '已知悉充值加载失败')
    } catch (error) { console.error(error); toast('已知悉充值加载失败') }
    finally { if (seq === this.acknowledgedSeq) this.setData({ acknowledgedLoading: false }); this.acknowledgedLoading = false }
  },

  switchTab(event) {
    const activeTab = event.currentTarget.dataset.tab
    if (activeTab === this.data.activeTab) return
    this.setData({ activeTab })
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
    if (activeTab === 'pending') this.loadPending()
    else if (activeTab === 'formal' && !this.data.formalLoaded) this.loadFormal(1)
    else if (activeTab === 'acknowledged' && !this.data.acknowledgedLoaded) this.loadAcknowledged(1)
  },

  navigateToCreate() {
    wx.showActionSheet({
      itemList: ['课程', '用户充值'],
      success: result => {
        if (result.tapIndex === 0) wx.navigateTo({ url: '/pages/coachCourseForm/coachCourseForm' })
        if (result.tapIndex === 1) wx.navigateTo({ url: '/pages/rechargeNoticeForm/rechargeNoticeForm' })
      }
    })
  },
  navigateToEditCourse(event) {
    const id = Number(event.currentTarget.dataset.id)
    const course = this.data.pendingList.find(item => item.submissionType === COURSE && Number(item.id) === id)
    if (!course) return
    wx.navigateTo({
      url: '/pages/coachCourseForm/coachCourseForm?mode=edit&id=' + id,
      success: result => result.eventChannel.emit('pendingCourse', course)
    })
  },
  navigateToEditNotice(event) {
    const id = Number(event.currentTarget.dataset.id)
    const source = this.data.activeTab === 'acknowledged' ? this.data.acknowledgedList : this.data.pendingList
    const notice = source.find(item => item.submissionType === RECHARGE_NOTICE && Number(item.id) === id)
    if (!notice) return
    wx.navigateTo({
      url: '/pages/rechargeNoticeForm/rechargeNoticeForm?mode=edit&id=' + id,
      success: result => result.eventChannel.emit('rechargeNotice', notice)
    })
  },
  togglePending(event) {
    const key = event.currentTarget.dataset.key
    this.setData({ [`pendingCollapsed.${key}`]: !this.data.pendingCollapsed[key] })
  },
  toggleFormal(event) { const id = event.currentTarget.dataset.id; this.setData({ [`formalCollapsed.${id}`]: !this.data.formalCollapsed[id] }) },

  deletePending(event) {
    const id = Number(event.currentTarget.dataset.id)
    wx.showModal({ title: '删除待审课程', content: '删除后无法恢复，确定删除吗？', success: async result => {
      if (!result.confirm) return
      try {
        const response = await this.call('pending_course', { action: 'delete', id, coachId: app.globalData.coachContext.coach.id })
        if (response && response.success) { toast('已删除'); this.pendingCourses = (this.pendingCourses || []).filter(item => Number(item.id) !== id); this.mergePending(); this.loadPending() }
        else if (response && response.code === 'PENDING_NOT_FOUND') { toast('课程已被管理员录取或已不存在'); this.pendingCourses = (this.pendingCourses || []).filter(item => Number(item.id) !== id); this.mergePending() }
        else toast((response && response.message) || '删除失败')
      } catch (error) { console.error(error); toast('删除失败') }
    } })
  },
  deleteNotice(event) {
    const id = Number(event.currentTarget.dataset.id)
    wx.showModal({ title: '删除充值待办', content: '删除后无法恢复，确定删除吗？', success: async result => {
      if (!result.confirm) return
      try {
        const response = await this.call('recharge_notice', { action: 'delete', id, coachId: app.globalData.coachContext.coach.id })
        if (response && response.success) { toast('已删除'); this.pendingNotices = (this.pendingNotices || []).filter(item => Number(item.id) !== id); this.mergePending(); this.loadPending() }
        else if (response && response.code === 'RECHARGE_NOTICE_ACKNOWLEDGED') { toast('管理员已知悉，不能删除'); this.loadPending() }
        else if (response && response.code === 'RECHARGE_NOTICE_NOT_FOUND') { toast('充值待办已不存在'); this.pendingNotices = (this.pendingNotices || []).filter(item => Number(item.id) !== id); this.mergePending() }
        else toast((response && response.message) || '删除失败')
      } catch (error) { console.error(error); toast('删除失败') }
    } })
  },

  previousFormalPage() { if (this.data.formalPage > 1) this.loadFormal(this.data.formalPage - 1) },
  nextFormalPage() { if (this.data.formalPage < this.data.formalTotalPages) this.loadFormal(this.data.formalPage + 1) },
  onFormalPageInput(event) { this.setData({ formalPageInput: event.detail.value }) },
  jumpFormalPage() {
    const page = Number(this.data.formalPageInput)
    if (!Number.isInteger(page) || page < 1 || page > this.data.formalTotalPages) return toast('请输入有效页码')
    this.loadFormal(page)
  },
  previousAcknowledgedPage() { if (this.data.acknowledgedPage > 1) this.loadAcknowledged(this.data.acknowledgedPage - 1) },
  nextAcknowledgedPage() { if (this.data.acknowledgedPage < this.data.acknowledgedTotalPages) this.loadAcknowledged(this.data.acknowledgedPage + 1) },
  onAcknowledgedPageInput(event) { this.setData({ acknowledgedPageInput: event.detail.value }) },
  jumpAcknowledgedPage() {
    const page = Number(this.data.acknowledgedPageInput)
    if (!Number.isInteger(page) || page < 1 || page > this.data.acknowledgedTotalPages) return toast('请输入有效页码')
    this.loadAcknowledged(page)
  },
  onPullDownRefresh() {
    let task
    if (this.data.activeTab === 'pending') task = this.loadPending()
    else if (this.data.activeTab === 'formal') task = this.loadFormal(this.data.formalPage)
    else task = this.loadAcknowledged(this.data.acknowledgedPage)
    Promise.resolve(task).finally(() => wx.stopPullDownRefresh())
  }
})
