const app = getApp()
const courseTypes = [{ value: -2, label: '体验课未成单' }, { value: -1, label: '体验课成单' }, { value: 0, label: '订场' }, { value: 1, label: '班课' }, { value: 2, label: '私教' }]
const deductionTypes = [{ value: 'charge', label: '课时费' }, { value: 'times', label: '次卡' }, { value: 'annual_times', label: '年卡' }]
const timeOptions = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`)
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const number = value => Number(value || 0)
const toast = title => wx.showToast({ title, icon: 'none' })
const decimalFields = new Set(['charge', 'times', 'annualTimes', 'description'])

function oneDecimalInput(value) {
  const input = String(value || '').replace(/[^\d.]/g, '')
  const decimalIndex = input.indexOf('.')
  if (decimalIndex < 0) return input
  return `${input.slice(0, decimalIndex)}.${input.slice(decimalIndex + 1).replace(/\./g, '').slice(0, 1)}`
}

function hasValue(value) { return String(value === undefined || value === null ? '' : value).trim() !== '' }

function memberComplete(member) {
  if (!member || !member.memberId || !member.deductionType || !Number.isInteger(Number(member.quantities)) || Number(member.quantities) <= 0) return false
  if (member.deductionType === 'charge') return hasValue(member.charge) && Number.isFinite(number(member.charge)) && number(member.charge) >= 0
  if (member.deductionType === 'times') return hasValue(member.times) && hasValue(member.description) && number(member.times) >= .5 && Math.abs(number(member.times) * 2 - Math.round(number(member.times) * 2)) < 1e-8 && number(member.description) >= 0
  return hasValue(member.annualTimes) && hasValue(member.description) && number(member.annualTimes) >= .5 && Math.abs(number(member.annualTimes) * 2 - Math.round(number(member.annualTimes) * 2)) < 1e-8 && number(member.description) >= 0
}
function decorateMember(member) {
  const copy = { ...member }
  copy.isDebt = Number(copy.restCharge || 0) - number(copy.charge) < 0 || Number(copy.timesCount || 0) - number(copy.times) < 0 || Number(copy.annualCount || 0) - number(copy.annualTimes) < 0
  return copy
}
function resetMemberSpend(member, type) {
  return decorateMember({ ...member, deductionType: type, charge: '', times: '', annualTimes: '', description: '' })
}

Page({
  data: {
    mode: 'create', pendingId: null, coach: null, courts: [], date: today(), startTime: '', endTime: '', duration: null,
    courseType: null, courseTypeIndex: -1, isAdult: 1, courtId: null, courtIndex: -1, description: '', members: [],
    timeOptions, endOptions: [], endIndex: -1, startIndex: -1, courseTypes, deductionTypes,
    memberKeyword: '', memberSearchLoading: false, memberResults: [], canSearchMember: true, submitting: false
  },

  async onLoad(options) {
    const context = await app.ensureCoachContext(wx.getStorageSync('phoneNumber'))
    if (!context.isCoach) return this.leaveSilently()
    this.setData({ mode: options.mode === 'edit' ? 'edit' : 'create', pendingId: options.id ? Number(options.id) : null, coach: context.coach, courts: context.courts || [] })
    if (options.mode === 'edit') {
      this.getOpenerEventChannel().on('pendingCourse', course => this.hydrate(course))
    }
  },
  onUnload() { if (this.searchTimer) clearTimeout(this.searchTimer); this.destroyed = true },
  leaveSilently() { const pages = getCurrentPages(); if (pages.length > 1) wx.navigateBack(); else wx.switchTab({ url: '/pages/member/member' }) },
  syncMembers(members) { this.setData({ members: members.map(decorateMember), canSearchMember: !members.length || memberComplete(members[members.length - 1]) }) },

  hydrate(course) {
    const members = (course.membersData || []).map(item => {
      const times = number(item.times); const annualTimes = number(item.annualTimes)
      return decorateMember({ memberId: item.memberId, memberName: item.memberName, memberNumber: item.memberNumber, restCharge: item.restCharge, timesCount: item.timesCount, annualCount: item.annualCount, deductionType: times > 0 ? 'times' : (annualTimes > 0 ? 'annual_times' : 'charge'), charge: number(item.charge), times, annualTimes, description: number(item.description), quantities: number(item.quantities) })
    })
    const startTime = String(course.startTime).slice(11, 16); const endTime = String(course.endTime).slice(11, 16)
    const courseTypeIndex = courseTypes.findIndex(item => Number(item.value) === Number(course.courseType)); const courtIndex = this.data.courts.findIndex(item => Number(item.id) === Number(course.courtId))
    this.setData({ date: String(course.startTime).slice(0, 10), startTime, endTime, duration: number(course.duration), courseType: Number(course.courseType), courseTypeIndex, isAdult: Number(course.isAdult), courtId: Number(course.courtId), courtIndex, startIndex: timeOptions.indexOf(startTime), endOptions: timeOptions.filter(item => item > startTime), endIndex: timeOptions.filter(item => item > startTime).indexOf(endTime), description: course.description || '' })
    this.syncMembers(members)
    wx.setNavigationBarTitle({ title: '修改课程' })
  },

  onDateChange(event) { this.setData({ date: event.detail.value, startTime: '', endTime: '', duration: null, startIndex: -1, endOptions: [], endIndex: -1, courseType: null, courseTypeIndex: -1, isAdult: 1, courtId: null, courtIndex: -1, description: '', memberKeyword: '', memberResults: [] }); this.syncMembers([]) },
  onStartChange(event) {
    const startTime = timeOptions[Number(event.detail.value)]
    this.setData({ startTime, startIndex: Number(event.detail.value), endTime: '', duration: null, endOptions: timeOptions.filter(item => item > startTime), endIndex: -1, courseType: null, courseTypeIndex: -1, isAdult: 1, courtId: null, courtIndex: -1, description: '', memberKeyword: '', memberResults: [] })
    this.syncMembers([])
  },
  onEndChange(event) {
    const endTime = this.data.endOptions[Number(event.detail.value)]; const [sh, sm] = this.data.startTime.split(':').map(Number); const [eh, em] = endTime.split(':').map(Number)
    this.setData({ endTime, endIndex: Number(event.detail.value), duration: (eh * 60 + em - sh * 60 - sm) / 60, courseType: null, courseTypeIndex: -1, isAdult: 1, courtId: null, courtIndex: -1, description: '', memberKeyword: '', memberResults: [] }); this.syncMembers([])
  },
  onCourseTypeChange(event) { const courseTypeIndex = Number(event.detail.value); const courseType = courseTypes[courseTypeIndex].value; this.setData({ courseType, courseTypeIndex, isAdult: 1, courtId: null, courtIndex: -1, description: '', memberKeyword: '', memberResults: [] }); this.syncMembers([]) },
  onAdultChange(event) { this.setData({ isAdult: Number(event.detail.value), courtId: null, courtIndex: -1, description: '', memberKeyword: '', memberResults: [] }); this.syncMembers([]) },
  onCourtChange(event) { const courtIndex = Number(event.detail.value); this.setData({ courtIndex, courtId: Number(this.data.courts[courtIndex].id), description: '', memberKeyword: '', memberResults: [] }); this.syncMembers([]) },
  onDescriptionInput(event) { this.setData({ description: String(event.detail.value || '').slice(0, 100) }) },

  onMemberKeyword(event) {
    const keyword = String(event.detail.value || '').trim(); this.setData({ memberKeyword: keyword })
    if (this.searchTimer) clearTimeout(this.searchTimer)
    if (!keyword || !this.data.canSearchMember) return this.setData({ memberResults: [], memberSearchLoading: false })
    const sequence = (this.searchSequence || 0) + 1; this.searchSequence = sequence
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
    const id = Number(event.currentTarget.dataset.id); const found = this.data.memberResults.find(item => Number(item.id) === id)
    if (!found) return
    if (this.data.members.some(item => Number(item.memberId) === id)) return toast('同一会员不能重复添加')
    this.syncMembers([...this.data.members, decorateMember({ memberId: id, memberName: found.name, memberNumber: found.number, restCharge: found.restCharge, timesCount: found.timesCount, annualCount: found.annualCount, deductionType: null, charge: '', times: '', annualTimes: '', description: '', quantities: 1 })])
    this.setData({ memberKeyword: '', memberResults: [] })
  },
  removeMember(event) { const index = Number(event.currentTarget.dataset.index); this.syncMembers(this.data.members.filter((_, current) => current !== index)) },
  onDeductionChange(event) { const index = Number(event.currentTarget.dataset.index); const type = deductionTypes[Number(event.detail.value)].value; const members = this.data.members.slice(); members[index] = resetMemberSpend(members[index], type); this.syncMembers(members) },
  onMemberInput(event) {
    const index = Number(event.currentTarget.dataset.index); const field = event.currentTarget.dataset.field; const members = this.data.members.slice(); const value = event.detail.value
    members[index] = { ...members[index], [field]: field === 'quantities' ? Number.parseInt(value, 10) || 0 : (decimalFields.has(field) ? oneDecimalInput(value) : value) }
    if (members[index].deductionType === 'charge') members[index].description = members[index].charge
    this.syncMembers(members)
  },

  validate() {
    const { date, startTime, endTime, duration, courseType, isAdult, courtId, members } = this.data
    if (!date || !startTime || !endTime || !duration || courseType === null || !courtId) return '请先完成课程基本信息'
    if (courseType !== 0 && ![0, 1].includes(Number(isAdult))) return '请选择成人或儿童'
    if (courseType < 0 && members.length) return '体验课不能填写会员'
    if (courseType >= 0 && !members.length) return '请至少添加一位会员'
    if (members.some(member => !memberComplete(member))) return '请完成每位会员的扣费信息'
    for (const member of members) {
      if ([number(member.charge), number(member.times), number(member.annualTimes), number(member.description)].some(value => value < 0 || Math.abs(value * 10 - Math.round(value * 10)) > 1e-8)) return '扣费金额最多保留一位小数'
      if ((member.deductionType === 'times' && number(member.times) < .5) || (member.deductionType === 'annual_times' && number(member.annualTimes) < .5)) return '次卡或年卡扣费最低为 0.5'
    }
    return ''
  },
  async submit() {
    const error = this.validate(); if (error) return toast(error)
    if (this.data.submitting) return
    const course = { courtId: this.data.courtId, startTime: `${this.data.date} ${this.data.startTime}:00`, endTime: `${this.data.date} ${this.data.endTime}:00`, duration: this.data.duration, courseType: this.data.courseType, isAdult: this.data.courseType === 0 ? 1 : this.data.isAdult, description: this.data.description, membersData: this.data.courseType < 0 ? [] : this.data.members.map(item => ({ memberId: item.memberId, charge: number(item.charge), times: number(item.times), annualTimes: number(item.annualTimes), description: number(item.description), quantities: Number(item.quantities) })) }
    this.setData({ submitting: true })
    try {
      const result = await new Promise((resolve, reject) => wx.cloud.callFunction({ name: 'pending_course', data: { action: this.data.mode === 'edit' ? 'update' : 'create', id: this.data.pendingId, coachId: app.globalData.coachContext.coach.id, course }, success: response => resolve(response.result), fail: reject }))
      if (result && result.success) { toast(this.data.mode === 'edit' ? '已保存' : '已提交'); setTimeout(() => wx.navigateBack(), 350) }
      else if (result && result.code === 'PENDING_NOT_FOUND') { toast('课程已被管理员录取或已不存在'); setTimeout(() => wx.navigateBack(), 800) }
      else toast((result && result.message) || '保存失败')
    } catch (failure) { console.error(failure); toast('保存失败') }
    finally { this.setData({ submitting: false }) }
  }
})
