const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const DEFAULT_CANCEL_REASON = '客户退款取消'

exports.main = async (event) => {
  const { order, cancelReason, operatorPhoneNumber } = event
  const { _id } = order || {}

  const db = cloud.database()

  if (!_id) {
    return {
      success: false,
      message: '订单不存在'
    }
  }

  const orderResult = await db.collection('pay_order').doc(_id).get()

  if (!orderResult.data) {
    return {
      success: false,
      message: '订单不存在'
    }
  }

  const orderData = orderResult.data
  const orderPhoneNumber = orderData.phoneNumber
  const courtIds = Array.isArray(orderData.court_ids) ? orderData.court_ids : []
  if (!orderData.campus) {
    return {
      success: false,
      message: '订单缺少校区信息，无法安全取消'
    }
  }
  const cancelOperatorPhone = operatorPhoneNumber || orderPhoneNumber
  const trimmedReason = (cancelReason || '').trim()

  const operatorManagerCheck = cancelOperatorPhone
    ? await db.collection('manager').where({ phoneNumber: cancelOperatorPhone }).get()
    : { data: [] }
  const isOperatorManager = operatorManagerCheck.data && operatorManagerCheck.data.length > 0

  const isOperatorCancelingOwnOrder = isOperatorManager && cancelOperatorPhone === orderPhoneNumber

  if (isOperatorCancelingOwnOrder && (!trimmedReason || trimmedReason === DEFAULT_CANCEL_REASON)) {
    return {
      success: false,
      message: '请输入取消理由'
    }
  }

  const finalCancelReason = isOperatorCancelingOwnOrder ? trimmedReason : DEFAULT_CANCEL_REASON
  const auditData = {
    cancel_reason: finalCancelReason,
    cancelled_at: db.serverDate(),
    cancel_operator_phone: cancelOperatorPhone
  }
  const buildCourtOrderQuery = (court_id) => {
    return {
      court_id,
      campus: orderData.campus
    }
  }

  const managerCheck = await db.collection('manager').where({
    phoneNumber: orderPhoneNumber
  }).get()

  const isManager = managerCheck.data && managerCheck.data.length > 0

  if (isManager) {
    if (cancelOperatorPhone !== orderPhoneNumber) {
      return {
        success: false,
        message: '只能取消自己的管理员订场订单'
      }
    }

    for (const court_id of courtIds) {
      await db.collection('court_order_collection')
        .where(buildCourtOrderQuery(court_id))
        .remove()
    }

    await db.collection('pay_order').doc(_id).update({
      data: {
        status: 'CANCEL',
        ...auditData
      }
    })
  } else {
    if (orderData.status === 'PENDING') {
      for (const court_id of courtIds) {
        const courtOrder = await db.collection('court_order_collection')
          .where({
            ...buildCourtOrderQuery(court_id),
            status: 'locked'
          })
          .get()

        if (courtOrder.data.length > 0) {
          const lockedOrder = courtOrder.data[0]
          if (lockedOrder.booked_by !== orderPhoneNumber) {
            return {
              success: false,
              message: '只能取消自己的预订'
            }
          }
        }
      }

      await db.collection('pay_order').doc(_id).update({
        data: {
          status: 'CANCEL',
          ...auditData
        }
      })

      for (const court_id of courtIds) {
        await db.collection('court_order_collection')
          .where({
            ...buildCourtOrderQuery(court_id),
            status: 'locked',
            booked_by: orderPhoneNumber
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
    success: true,
    _id,
    court_ids: courtIds,
    status: 'CANCEL'
  }
}
