const { pickStoredUserProfile } = require("./userProfile");
let serverOffset = 0;
const AUTH_ERRORS = ["AUTH_REQUIRED"];
const DISPLAY_ERRORS = {
  INVALID_PRICE: "原价和优惠金额须为至少1元的整数，优惠金额不得高于原价",
  VIP_UNAVAILABLE: "课程价格暂时无法查询，请稍后重试",
};
// Business identity is the same phoneNumber used by the personal center and rush.
// Read current shared data on every request so login changes take effect immediately.
function loginIdentity() {
  const app = typeof getApp === "function" ? getApp() : null;
  const global = (app && app.globalData) || {};
  const { profile } = pickStoredUserProfile({
    userProfile: global.userProfile || wx.getStorageSync("userProfile"),
    legacyUserInfo: wx.getStorageSync("userInfo"),
  });
  return {
    phoneNumber: String(wx.getStorageSync("phoneNumber") || "").trim(),
    profile,
  };
}
// Reuse the same manager cache as rush for entry visibility; writes still check the DB.
function canCreateCourse() {
  const phone = loginIdentity().phoneNumber;
  if (!phone) return false;
  const app = typeof getApp === "function" ? getApp() : null;
  const global = (app && app.globalData) || {};
  const cached = wx.getStorageSync("managerPermissions") || {};
  const rush = global.courtRushManagerList || cached.courtRushManagerList || [];
  const special = global.specialManagerList || cached.specialManagerList || [];
  return [...rush, ...special].some(value => String(value).trim() === phone);
}
function watchPermissions(callback) {
  const app = typeof getApp === "function" ? getApp() : null;
  const bus = app && app.globalData && app.globalData.eventBus;
  if (!bus) return () => {};
  bus.on("managerPermissionsUpdated", callback);
  return () => bus.off("managerPermissionsUpdated", callback);
}
async function refreshPermissions() {
  const response = await wx.cloud.callFunction({ name: "manager_permissions" });
  const permissions = response && response.result;
  if (!permissions || permissions.success === false || !Array.isArray(permissions.courtRushManagerList))
    throw error("PERMISSIONS_UNAVAILABLE", "权限刷新失败，请稍后重试", true);
  const app = typeof getApp === "function" ? getApp() : null;
  wx.setStorageSync("managerPermissions", permissions);
  if (app && app.applyManagerPermissions) app.applyManagerPermissions(permissions);
  if (app && app.globalData && app.globalData.eventBus)
    app.globalData.eventBus.emit("managerPermissionsUpdated", permissions);
}
function error(code, message, retryable) {
  return Object.assign(new Error(message || "暂时无法完成，请稍后重试"), {
    code,
    retryable: !!retryable,
  });
}
async function call(action, input) {
  const identity = loginIdentity();
  let response;
  try {
    response = await wx.cloud.callFunction({
      name: "group_course",
      data: Object.assign(
        {},
        input,
        { action },
        { phoneNumber: identity.phoneNumber },
        identity.profile ? { nickName: identity.profile.nickName, avatarUrl: identity.profile.avatarUrl } : {},
      ),
    });
  } catch (e) {
    throw error("NETWORK_ERROR", "网络连接中断，请重试核实结果", true);
  }
  const result = response && response.result;
  if (!result || typeof result.success !== "boolean")
    throw error("INTERNAL_ERROR", "服务暂时不可用，请重试", true);
  if (Number.isFinite(result.serverTime))
    serverOffset = result.serverTime - Date.now();
  if (!result.success) {
    if (identity.phoneNumber && ["AUTH_REQUIRED", "AUTH_INVALID", "AUTH_EXPIRED"].includes(result.error)) {
      throw error("LOGIN_CONTRACT_MISMATCH", "已读取个人中心手机号，但团课服务未识别。请更新团课云函数后重试，无需重新登录", true);
    }
    const failure = error(result.error, DISPLAY_ERRORS[result.error] || result.message, result.retryable);
    failure.details = result.details;
    throw failure;
  }
  const viewer = result.data && result.data.viewer;
  if (identity.phoneNumber && viewer &&
      (!viewer.authenticated || viewer.phoneNumber !== identity.phoneNumber)) {
    throw error("LOGIN_CONTRACT_MISMATCH", "团课服务返回的身份与当前手机号不一致，请更新团课云函数后重试", true);
  }
  return result.data;
}
function isAuthError(e) {
  return AUTH_ERRORS.includes(e.code);
}
function now() {
  return Date.now() + serverOffset;
}
module.exports = {
  call,
  canCreateCourse,
  watchPermissions,
  refreshPermissions,
  isAuthError,
  now,
  hasAuth: () => !!loginIdentity().phoneNumber,
  hasProfile: () => !!loginIdentity().profile,
};
