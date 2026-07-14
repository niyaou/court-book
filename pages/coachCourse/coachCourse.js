const app = getApp()

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

Page({
  data: {
    activeTab: 'pending', pendingList: [], pendingLoading: false, pendingLoaded: false, pendingCollapsed: {},
    formalList: [], formalLoading: false, formalLoaded: false, formalPage: 1, formalPageInput: '1', formalTotal: 0, formalTotalPages: 0, formalCollapsed: {}
  },

  async onLoad() {
    const context = await app.ensureCoachContext(wx.getStorageSync('phoneNumber'))
    if (!context.isCoach) return this.leaveSilently()
    this.ready = true
    this.loadPending()
  },

  onShow() { if (this.ready && this.data.activeTab === 'pending') this.loadPending() },
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

  async loadPending() {
    if (this.pendingLoading) return
    this.pendingLoading = true
    this.setData({ pendingLoading: true })
    const seq = (this.pendingSeq || 0) + 1; this.pendingSeq = seq
    try {
      const result = await this.call('pending_course', { action: 'list', coachId: app.globalData.coachContext.coach.id })
      if (seq !== this.pendingSeq) return
      if (result && result.success) this.setData({ pendingList: (result.data || []).map(decorateCourse), pendingLoaded: true })
      else if (result) toast(result.message || '待审课加载失败')
    } catch (error) { console.error(error); toast('待审课加载失败') }
    finally { if (seq === this.pendingSeq) this.setData({ pendingLoading: false }); this.pendingLoading = false }
  },

  async loadFormal(page = this.data.formalPage) {
    if (this.formalLoading) return
    this.formalLoading = true; this.setData({ formalLoading: true })
    const seq = (this.formalSeq || 0) + 1; this.formalSeq = seq
    try {
      const result = await this.call('coach_course_list', { coachId: app.globalData.coachContext.coach.id, page })
      if (seq !== this.formalSeq) return
      if (result && result.success) {
        this.setData({ formalList: (result.data || []).map(decorateCourse), formalLoaded: true, formalPage: result.page, formalPageInput: String(result.page), formalTotal: result.total, formalTotalPages: result.totalPages })
        wx.pageScrollTo({ scrollTop: 0, duration: 0 })
      } else if (result) toast(result.message || '正式课加载失败')
    } catch (error) { console.error(error); toast('正式课加载失败') }
    finally { if (seq === this.formalSeq) this.setData({ formalLoading: false }); this.formalLoading = false }
  },

  switchTab(event) {
    const activeTab = event.currentTarget.dataset.tab
    if (activeTab === this.data.activeTab) return
    this.setData({ activeTab })
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
    if (activeTab === 'pending') this.loadPending()
    else if (!this.data.formalLoaded) this.loadFormal(1)
  },

  navigateToCreate() { wx.navigateTo({ url: '/pages/coachCourseForm/coachCourseForm' }) },
  navigateToEdit(event) {
    const id = Number(event.currentTarget.dataset.id)
    const course = this.data.pendingList.find(item => Number(item.id) === id)
    if (!course) return
    wx.navigateTo({
      url: '/pages/coachCourseForm/coachCourseForm?mode=edit&id=' + id,
      success: (result) => result.eventChannel.emit('pendingCourse', course)
    })
  },
  togglePending(event) { const id = event.currentTarget.dataset.id; this.setData({ [`pendingCollapsed.${id}`]: !this.data.pendingCollapsed[id] }) },
  toggleFormal(event) { const id = event.currentTarget.dataset.id; this.setData({ [`formalCollapsed.${id}`]: !this.data.formalCollapsed[id] }) },

  deletePending(event) {
    const id = Number(event.currentTarget.dataset.id)
    wx.showModal({ title: '删除待审课程', content: '删除后无法恢复，确定删除吗？', success: async result => {
      if (!result.confirm) return
      try {
        const response = await this.call('pending_course', { action: 'delete', id, coachId: app.globalData.coachContext.coach.id })
        if (response && response.success) { toast('已删除'); this.setData({ pendingList: this.data.pendingList.filter(item => Number(item.id) !== id) }); this.loadPending() }
        else if (response && response.code === 'PENDING_NOT_FOUND') { toast('课程已被管理员录取或已不存在'); this.setData({ pendingList: this.data.pendingList.filter(item => Number(item.id) !== id) }) }
        else toast((response && response.message) || '删除失败')
      } catch (error) { console.error(error); toast('删除失败') }
    } })
  },

  previousPage() { if (this.data.formalPage > 1) this.loadFormal(this.data.formalPage - 1) },
  nextPage() { if (this.data.formalPage < this.data.formalTotalPages) this.loadFormal(this.data.formalPage + 1) },
  onPageInput(event) { this.setData({ formalPageInput: event.detail.value }) },
  jumpPage() {
    const page = Number(this.data.formalPageInput)
    if (!Number.isInteger(page) || page < 1 || page > this.data.formalTotalPages) return toast('请输入有效页码')
    this.loadFormal(page)
  },
  onPullDownRefresh() {
    const task = this.data.activeTab === 'pending' ? this.loadPending() : this.loadFormal(this.data.formalPage)
    Promise.resolve(task).finally(() => wx.stopPullDownRefresh())
  }
})
