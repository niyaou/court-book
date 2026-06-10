// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function normalizePhoneList(rows, predicate) {
  return (rows || [])
    .filter(predicate)
    .map(item => item.phoneNumber)
    .filter(Boolean)
}

// 云函数入口函数
exports.main = async () => {
  const db = cloud.database()

  try {
    const { data } = await db.collection('manager').get()
    const rows = data || []

    return {
      managerList: normalizePhoneList(rows, () => true),
      specialManagerList: normalizePhoneList(rows, item => Number(item.specialManager || 0) >= 1),
      courtRushManagerList: normalizePhoneList(rows, item => Number(item.courtRushManager || 0) >= 1 || Number(item.specialManager || 0) >= 1),
      accountManagerList: normalizePhoneList(rows, item => Number(item.accountManager || 0) >= 1)
    }
  } catch (error) {
    console.error('获取管理员权限失败:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

exports._test = {
  normalizePhoneList
}
