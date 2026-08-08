const app = getApp()
const toast = title => wx.showToast({ title, icon: 'none' })

Page({
  data: {
    mode: 'create', noticeId: null, version: null, coach: null,
    rechargeDate: '提交时由系统生成', member: null, memberKeyword: '', memberSearchLoading: false, memberResults: [],
    note: '', noteLength: 0, submitting: false
  },

  async onLoad(options) {
    const context = await app.ensureCoachContext(wx.getStorageSync('phoneNumber'))
    if (!context.isCoach) return this.leaveSilently()
    const mode = options.mode === 'edit' ? 'edit' : 'create'
    this.setData({ mode, noticeId: options.id ? Number(options.id) : null, coach: context.coach })
    if (mode === 'edit') {
      this.getOpenerEventChannel().on('rechargeNotice', notice => this.hydrate(notice))
      wx.setNavigationBarTitle({ title: '修改充值待办' })
    }
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.destroyed = true
  },

  leaveSilently() {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/member/member' })
  },

  hydrate(notice) {
    this.setData({
      version: Number(notice.version),
      rechargeDate: notice.rechargeDate || '',
      member: {
        id: Number(notice.memberId),
        name: notice.memberName || '已失效会员',
        number: notice.memberNumber || '',
        active: notice.memberActive !== false
      },
      note: notice.note || '',
      noteLength: String(notice.note || '').length
    })
  },

  onMemberKeyword(event) {
    const keyword = String(event.detail.value || '').trim()
    this.setData({ memberKeyword: keyword })
    if (this.searchTimer) clearTimeout(this.searchTimer)
    const sequence = (this.searchSequence || 0) + 1
    this.searchSequence = sequence
    if (!keyword) return this.setData({ memberResults: [], memberSearchLoading: false })
    this.searchTimer = setTimeout(() => this.searchMembers(keyword, sequence), 300)
  },

  async searchMembers(keyword, sequence) {
    this.setData({ memberSearchLoading: true })
    try {
      const result = await new Promise((resolve, reject) => wx.cloud.callFunction({ name: 'member_search', data: { keyword }, success: response => resolve(response.result), fail: reject }))
      if (sequence !== this.searchSequence || this.destroyed) return
      if (result && result.success) this.setData({ memberResults: result.data || [] })
      else toast((result && result.message) || '会员搜索失败')
    } catch (error) { console.error(error); toast('会员搜索失败') }
    finally { if (sequence === this.searchSequence && !this.destroyed) this.setData({ memberSearchLoading: false }) }
  },

  chooseMember(event) {
    const id = Number(event.currentTarget.dataset.id)
    const found = this.data.memberResults.find(item => Number(item.id) === id)
    if (!found) return
    this.searchSequence = (this.searchSequence || 0) + 1
    this.setData({ member: { id, name: found.name, number: found.number || '', active: true }, memberKeyword: '', memberResults: [], memberSearchLoading: false })
  },

  clearMember() { this.setData({ member: null, memberKeyword: '', memberResults: [] }) },
  onNoteInput(event) {
    const note = String(event.detail.value || '').slice(0, 500)
    this.setData({ note, noteLength: note.length })
  },

  validate() {
    if (!this.data.member || !Number.isInteger(Number(this.data.member.id))) return '请选择会员'
    const note = String(this.data.note || '').trim()
    if (!note) return '请填写充值备注'
    if (note.length > 500) return '充值备注不能超过 500 个字符'
    if (this.data.mode === 'edit' && (!Number.isInteger(Number(this.data.version)) || Number(this.data.version) <= 0)) return '记录版本无效，请返回刷新'
    return ''
  },

  async submit() {
    const error = this.validate()
    if (error) return toast(error)
    if (this.data.submitting) return
    this.setData({ submitting: true })
    const notice = { memberId: Number(this.data.member.id), note: String(this.data.note).trim() }
    if (this.data.mode === 'edit') notice.version = Number(this.data.version)
    try {
      const result = await new Promise((resolve, reject) => wx.cloud.callFunction({
        name: 'recharge_notice',
        data: { action: this.data.mode === 'edit' ? 'update' : 'create', id: this.data.noticeId, coachId: app.globalData.coachContext.coach.id, notice },
        success: response => resolve(response.result),
        fail: reject
      }))
      if (result && result.success) {
        toast(this.data.mode === 'edit' ? '已重新提交' : '已提交')
        setTimeout(() => wx.navigateBack(), 350)
      } else if (result && result.code === 'RECHARGE_NOTICE_UPDATED') {
        toast('记录已被修改，请返回刷新')
        setTimeout(() => wx.navigateBack(), 900)
      } else if (result && result.code === 'RECHARGE_NOTICE_NOT_FOUND') {
        toast('充值待办已不存在')
        setTimeout(() => wx.navigateBack(), 900)
      } else toast((result && result.message) || '保存失败')
    } catch (failure) { console.error(failure); toast('保存失败') }
    finally { this.setData({ submitting: false }) }
  }
})
