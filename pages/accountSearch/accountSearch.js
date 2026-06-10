const MEMBER_FIELD_LABELS = [
  { key: 'id', label: 'ID' },
  { key: 'annual_count', label: '年卡次数' },
  { key: 'annual_expire_time', label: '年卡到期时间' },
  { key: 'name', label: '姓名' },
  { key: 'number', label: '电话' },
  { key: 'rest_charge', label: '余额' },
  { key: 'times_count', label: '次卡次数' },
  { key: 'times_expire_time', label: '次卡到期时间' },
  { key: 'court', label: '所属场地' },
  { key: 'equivalent_balance', label: '等价余额' },
  { key: 'adults', label: '成人' },
  { key: 'younths', label: '青少年' },
  { key: 'deleted_at', label: '删除时间' }
]

Page({
  data: {
    operatorPhoneNumber: '',
    name: '',
    number: '',
    loading: false,
    searched: false,
    empty: false,
    resultList: [],
    errorMessage: ''
  },

  onLoad: function() {
    const operatorPhoneNumber = wx.getStorageSync('phoneNumber') || ''
    this.setData({ operatorPhoneNumber })

    if (!operatorPhoneNumber) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1200)
    }
  },

  onNameInput: function(e) {
    this.setData({ name: (e.detail.value || '').trim() })
  },

  onNumberInput: function(e) {
    this.setData({ number: (e.detail.value || '').trim() })
  },

  onClear: function() {
    this.setData({
      name: '',
      number: '',
      searched: false,
      empty: false,
      resultList: [],
      errorMessage: ''
    })
  },

  formatValue: function(value) {
    if (value === null || value === undefined || value === '') {
      return '-'
    }
    if (typeof value === 'object') {
      if (value instanceof Date) {
        return this.formatDate(value)
      }
      if (value.$date) {
        return this.formatDate(new Date(value.$date))
      }
    }
    return String(value)
  },

  formatDate: function(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return '-'
    }
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  },

  normalizeRows: function(rows) {
    return (rows || []).map((row) => ({
      id: row.id,
      title: row.name || row.number || `会员账户 ${row.id || ''}`,
      subtitle: row.number || '-',
      fields: MEMBER_FIELD_LABELS.map((field) => ({
        key: field.key,
        label: field.label,
        value: this.formatValue(row[field.key])
      }))
    }))
  },

  onSearch: function() {
    const { operatorPhoneNumber, name, number, loading } = this.data
    if (loading) return

    if (!name && !number) {
      wx.showToast({ title: '请至少输入姓名或电话', icon: 'none' })
      return
    }

    this.setData({
      loading: true,
      searched: true,
      empty: false,
      errorMessage: ''
    })

    wx.cloud.callFunction({
      name: 'account_member_search',
      data: {
        operatorPhoneNumber,
        name,
        number
      },
      success: (res) => {
        const result = res.result || {}
        if (result.success) {
          const resultList = this.normalizeRows(result.data || [])
          this.setData({
            loading: false,
            resultList,
            empty: resultList.length === 0,
            errorMessage: ''
          })
        } else {
          const message = result.message || '查询失败'
          this.setData({
            loading: false,
            resultList: [],
            empty: false,
            errorMessage: message
          })
          wx.showToast({ title: message, icon: 'none' })
        }
      },
      fail: (err) => {
        console.error('账户查询失败:', err)
        this.setData({
          loading: false,
          resultList: [],
          empty: false,
          errorMessage: '查询失败，请稍后重试'
        })
        wx.showToast({ title: '查询失败，请稍后重试', icon: 'none' })
      }
    })
  }
})
