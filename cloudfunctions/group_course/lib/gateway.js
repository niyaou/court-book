"use strict";
const { MINUTE, ms, random, beijing } = require("./core");
const paymentConfig = require("./paymentConfig");
const normalized = (r) =>
  Object.fromEntries(
    Object.entries(r || {}).map(([k, v]) => [
      k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()),
      v,
    ]),
  );
function success(r) {
  return r.returnCode === "SUCCESS" && r.resultCode === "SUCCESS";
}
function paymentResult(raw, p) {
  const r = normalized(raw);
  if (!success(r)) return { state: "UNKNOWN", code: r.errCode || r.returnCode };
  if (r.tradeState === "SUCCESS") {
    if (
      r.outTradeNo !== p.outTradeNo ||
      Number(r.totalFee) !== p.amountYuan * 100 ||
      !r.transactionId
    )
      throw Error("PAYMENT_RESPONSE_MISMATCH");
    return { state: "PAID", transactionId: r.transactionId };
  }
  return {
    state: ["CLOSED", "REVOKED", "PAYERROR"].includes(r.tradeState)
      ? "CLOSED"
      : "UNPAID",
  };
}
function refundResult(raw, r, p) {
  const q = normalized(raw);
  if (!success(q))
    return {
      state: q.errCode === "REFUNDNOTEXIST" ? "NOT_FOUND" : "UNKNOWN",
      code: q.errCode || q.returnCode,
    };
  let entry;
  if (q.outRefundNo === r.outRefundNo) entry = q;
  for (const k of Object.keys(q)) {
    const match = /^outRefundNo(\d+)$/.exec(k);
    if (match && q[k] === r.outRefundNo) {
      const i = match[1];
      entry = {
        outRefundNo: q[k],
        refundStatus: q["refundStatus" + i],
        refundFee: q["refundFee" + i],
        refundId: q["refundId" + i],
      };
      break;
    }
  }
  if (
    !entry ||
    q.outTradeNo !== p.outTradeNo ||
    Number(entry.refundFee) !== r.amountYuan * 100
  )
    throw Error("REFUND_RESPONSE_MISMATCH");
  const state =
    entry.refundStatus === "SUCCESS"
      ? "SUCCESS"
      : ["CHANGE", "REFUNDCLOSE"].includes(entry.refundStatus)
        ? "FAILED"
        : entry.refundStatus === "PROCESSING"
          ? "PROCESSING"
          : "UNKNOWN";
  return {
    state,
    channelStatus: entry.refundStatus,
    refundId: entry.refundId || "",
    code: state === "FAILED" ? entry.refundStatus : "",
  };
}
function createGateway(cloud) {
  const options = () => ({ subMchId: paymentConfig.subMchId, nonceStr: random() });
  // A timeout never implies the merchant request failed; query before resubmission.
  async function call(name, args) {
    let timer;
    try {
      return await Promise.race([
        cloud.cloudPay[name](args),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error("GATEWAY_TIMEOUT")), 15000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async createPayment(p, course, openid) {
      const r = normalized(
        await call("unifiedOrder", {
          ...options(),
          outTradeNo: p.outTradeNo,
          body: course.title.slice(0, 100),
          totalFee: p.amountYuan * 100,
          openid,
          spbillCreateIp: "127.0.0.1",
          tradeType: "JSAPI",
          timeExpire: beijing(ms(p.createdAt) + 2 * MINUTE).stamp,
          envId: paymentConfig.envId,
          functionName: "group_course_payment_callback",
        }),
      );
      if (success(r) && r.payment)
        return { state: "CREATED", paymentParams: r.payment };
      if (
        r.returnCode === "SUCCESS" &&
        r.resultCode === "FAIL" &&
        [
          "PARAM_ERROR",
          "INVALID_REQUEST",
          "NOAUTH",
          "NOTENOUGH",
          "ORDERCLOSED",
          "ORDERREVERSED",
        ].includes(r.errCode)
      )
        return { state: "FAILED", code: r.errCode };
      return { state: "UNKNOWN" };
    },
    async queryPayment(p) {
      return paymentResult(
        await call("queryOrder", { ...options(), outTradeNo: p.outTradeNo }),
        p,
      );
    },
    async submitRefund(r, p) {
      const q = normalized(
        await call("refund", {
          ...options(),
          outTradeNo: p.outTradeNo,
          outRefundNo: r.outRefundNo,
          totalFee: p.amountYuan * 100,
          refundFee: r.amountYuan * 100,
          envId: paymentConfig.envId,
          functionName: "group_course_refund_callback",
        }),
      );
      return {
        state: success(q) ? "PROCESSING" : "UNKNOWN",
        code: q.errCode || "",
      };
    },
    async queryRefund(r, p) {
      return refundResult(
        await call("queryRefund", { ...options(), outRefundNo: r.outRefundNo }),
        r,
        p,
      );
    },
  };
}
module.exports = { createGateway, normalized, paymentResult, refundResult };
