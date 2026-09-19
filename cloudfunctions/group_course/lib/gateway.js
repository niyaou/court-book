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
  // Capture the SDK response before normalization; preserve keys and arrays.
  // Only monetary/count/status values are safe to retain in diagnostic logs.
  const rawResponse = redactRefundResponse(raw);
  const q = normalized(raw);
  if (!success(q))
    return {
      state: q.errCode === "REFUNDNOTEXIST" ? "NOT_FOUND" : "UNKNOWN",
      code: q.errCode || q.returnCode,
    };
  let entry;
  // CloudPay queryRefund returns parallel lists; select all fields using the
  // exact refund number's index, never the first refund or a top-level amount.
  if (Array.isArray(q.outRefundNoList)) {
    const index = q.outRefundNoList.indexOf(r.outRefundNo);
    if (index >= 0) {
      entry = {
        outRefundNo: q.outRefundNoList[index],
        refundStatus: Array.isArray(q.refundStatusList) ? q.refundStatusList[index] : undefined,
        refundFee: Array.isArray(q.refundFeeList) ? q.refundFeeList[index] : undefined,
        refundId: Array.isArray(q.refundIdList) ? q.refundIdList[index] : undefined,
      };
    }
  }
  if (!Array.isArray(q.outRefundNoList) && q.outRefundNo === r.outRefundNo) entry = q;
  for (const k of Object.keys(q)) {
    if (Array.isArray(q.outRefundNoList)) break;
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
  ) {
    const error = new Error("REFUND_RESPONSE_MISMATCH");
    error.code = "REFUND_RESPONSE_MISMATCH";
    // Log schema and comparison results, never the full payment response.
    error.details = {
      parserVersion: "refund-lists-diagnostic-v2",
      rawResponse,
      refundMatched: !!entry,
      paymentMatched: q.outTradeNo === p.outTradeNo,
      expectedRefundFee: r.amountYuan * 100,
      refundCount: q.refundCount ?? null,
      totalRefundCount: q.totalRefundCount ?? null,
      receivedRefundFee: entry?.refundFee ?? null,
      refundLists: Object.fromEntries([
        "outRefundNoList", "refundFeeList", "refundStatusList", "refundIdList",
      ].map((key) => [key, describeRefundField(q[key], r.outRefundNo)])),
      responseFields: Object.keys(q).sort(),
      nestedFields: Object.fromEntries(Object.entries(q)
        .filter(([, value]) => value && typeof value === "object")
        .map(([key, value]) => [key, {
          type: Array.isArray(value) ? "array" : "object",
          fields: Object.keys(Array.isArray(value) ? (value[0] || {}) : value).sort(),
        }])),
    };
    throw error;
  }
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
function redactRefundResponse(value, field = "") {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((item) => redactRefundResponse(item, field));
  if (typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactRefundResponse(item, key)]),
  );
  const key = field.replace(/_/g, "").toLowerCase();
  if (/^(refundfee|settlementrefundfee|totalfee|cashfee|refundcount|totalrefundcount)(list)?\d*$/.test(key) &&
      (typeof value === "number" || /^\d+$/.test(String(value)))) return value;
  if (/^(returncode|resultcode|refundstatus(list)?\d*)$/.test(key) &&
      ["SUCCESS", "FAIL", "PROCESSING", "CHANGE", "REFUNDCLOSE"].includes(value)) return value;
  return typeof value === "string" && value === "" ? "" : "[REDACTED]";
}
function describeRefundField(value, expectedRefundNo, depth = 0) {
  if (value == null) return { type: value === null ? "null" : "undefined" };
  if (typeof value === "string") return {
    type: "string", length: value.length, matchesRefundNo: value === expectedRefundNo,
    ...( ["SUCCESS", "PROCESSING", "CHANGE", "REFUNDCLOSE"].includes(value) ? { status: value } : {}),
  };
  if (typeof value === "number") return { type: "number", value };
  if (typeof value !== "object") return { type: typeof value };
  const summary = { type: Array.isArray(value) ? "array" : "object" };
  if (Array.isArray(value)) summary.length = value.length;
  if (depth < 3) summary.entries = Object.fromEntries(Object.entries(value).slice(0, 10)
    .map(([key, item]) => [key, describeRefundField(item, expectedRefundNo, depth + 1)]));
  return summary;
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
      const raw = await call("queryRefund", { ...options(), outRefundNo: r.outRefundNo });
      const q = normalized(raw);
      // Empty detail lists are inconclusive, not proof of a missing refund.
      // Retry once by the original payment number, retaining exact refund checks.
      const empty = success(q) && q.outTradeNo === p.outTradeNo &&
        ["outRefundNoList", "refundFeeList", "refundStatusList", "refundIdList"]
          .every((key) => Array.isArray(q[key]) && q[key].length === 0);
      if (!empty) return refundResult(raw, r, p);
      try {
        const byPayment = await call("queryRefund", { ...options(), outTradeNo: p.outTradeNo, offset: 0 });
        const result = refundResult(byPayment, r, p);
        // A conflicting not-found result must not trigger another submission.
        return result.state === "NOT_FOUND"
          ? { state: "UNKNOWN", code: "REFUND_QUERY_EMPTY" }
          : result;
      } catch (error) {
        if (error.details) error.details = {
          ...error.details,
          queryMode: "outTradeNo-after-empty-outRefundNo",
          initialRefundCount: q.refundCount ?? null,
        };
        throw error;
      }
    },
  };
}
module.exports = { createGateway, normalized, paymentResult, refundResult };
