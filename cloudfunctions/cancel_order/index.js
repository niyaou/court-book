// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

// 云函数入口函数
exports.main = async (event, ) => {
  const { order } = event
  const { _id, court_ids } = order

  const db = cloud.database()
  
  // 查询订单
  const orderResult = await db.collection('pay_order').doc(_id).get()
  
  // 检查订单是否存在
  if (!orderResult.data) {
    return {
    
      message: '订单不存在'
    }
  }

  const phoneNumber = orderResult.data.phoneNumber
  
  // 检查是否是管理员
  const managerCheck = await db.collection('manager').where({
    phoneNumber: phoneNumber
  }).get()

  const isManager = managerCheck.data && managerCheck.data.length > 0

  if (isManager) {
    // 如果是管理员，直接删除court_order_collection中的记录
    for (const court_id of court_ids) {
      await db.collection('court_order_collection')
        .where({
          court_id: court_id
        })
        .remove()
    }
    
    // 更新订单状态为CANCEL
    await db.collection('pay_order').doc(_id).update({
      data: {
        status: 'CANCEL'
      }
    })
  } else {
    // 如果不是管理员，使用原有逻辑
    // 如果订单状态是PENDING，则更新为CANCEL
    if (orderResult.data.status === 'PENDING') {
      // 检查普通用户是否只能取消自己的锁定订单
      for (const court_id of court_ids) {
        const courtOrder = await db.collection('court_order_collection')
          .where({
            court_id: court_id,
            status: 'locked'
          })
          .get()
        
        // 检查是否存在锁定订单，且是否为当前用户创建的
        if (courtOrder.data.length > 0) {
          const lockedOrder = courtOrder.data[0]
          if (lockedOrder.booked_by !== phoneNumber) {
            return {
              success: false,
              message: '只能取消自己的预订'
            }
          }
        }
      }
      
      await db.collection('pay_order').doc(_id).update({
        data: {
          status: 'CANCEL'
        }
      })

      // 删除court_order_collection中匹配的记录
      for (const court_id of court_ids) {
        await db.collection('court_order_collection')
          .where({
            court_id: court_id,
            status: 'locked',
            booked_by: phoneNumber // 确保只能删除自己的锁定订单
          })
          .remove()
      }
    } else {
      return {
        success: false,
        message: '只能取消待支付的订单'
      }
    }
  }

  return {
    _id,
    court_ids,
    status: 'CANCEL'
  }
}