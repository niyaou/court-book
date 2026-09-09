const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const view = require("../utils/groupCourseView");
const root = path.resolve(__dirname, "..");
function loadPage(name, api, wxOverrides = {}) {
  api = { hasAuth: () => false, canCreateCourse: () => false, watchPermissions: () => () => {}, ...api };
  let definition;
  const storage = new Map();
  const wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    redirectTo() {},
    navigateTo() {},
    switchTab() {},
    showModal: (options) => options.success({ confirm: true }),
    ...wxOverrides,
  };
  const sandbox = {
    Page: (page) => {
      definition = page;
    },
    require: (spec) => (spec.includes("groupCourseApi") ? api : view),
    module: { exports: {} },
    wx,
    setInterval: () => 1,
    clearInterval() {},
    console,
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, `pages/${name}/${name}.js`), "utf8"),
    sandbox,
  );
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  return { page, storage, exports: sandbox.module.exports, wx };
}
const form = {
  templateId: "t1",
  title: "正手基础",
  description: "教学内容",
  coachId: "coach",
  campus: "麓坊校区",
  courtId: "court",
  date: "2026-10-10",
  startTime: "15:00",
  endTime: "16:30",
  priceYuan: "128",
  vipPriceYuan: "89",
  minParticipants: "4",
  maxParticipants: "8",
};
const now = Date.UTC(2026, 9, 1);
const fakeApi = (overrides) => ({
  now: () => now,
  isAuthError: (e) => e.code === "AUTH_REQUIRED",
  hasAuth: () => true,
  call: async () => ({}),
  ...overrides,
});
function readyForm(api) {
  const context = loadPage("groupCourseForm", api);
  context.page.setData({
    viewer: { isAdmin: true },
    canManage: true,
    form: { ...form },
    coachLabel: "王教练",
    courtLabel: "2号场",
    campuses: [{ name: form.campus, bookingManaged: true }],
  });
  return context;
}
test("Beijing dates reject invalid rolled calendar days and non-half-hours", () => {
  assert.equal(view.parseBeijing("2026-02-30", "15:00"), NaN);
  assert.equal(view.parseBeijing("2026-10-10", "15:15"), NaN);
  assert.equal(
    view.dateTime(view.parseBeijing("2026-10-10", "15:00")),
    "2026-10-10 15:00",
  );
});
test("creation validates integer price, participant limits and strict publish deadline", () => {
  const { exports } = loadPage("groupCourseForm", fakeApi());
  assert.equal(exports.validate(form, now).priceYuan, 128);
  assert.equal(exports.validate(form, now).vipPriceYuan, 89);
  assert.equal(exports.validate({ ...form, priceYuan: "1", vipPriceYuan: "1" }, now).vipPriceYuan, 1);
  for (const vipPriceYuan of ["", "0", "-1", "1.5", "129"])
    assert.throws(() => exports.validate({ ...form, vipPriceYuan }, now));
  assert.throws(() => exports.validate({ ...form, priceYuan: "1" }, now));
  assert.throws(() => exports.validate({ ...form, priceYuan: "2.5" }, now));
  assert.throws(() => exports.validate({ ...form, minParticipants: "9" }, now));
  assert.throws(() =>
    exports.validate(
      form,
      view.parseBeijing(form.date, form.startTime) - 3600000,
    ),
  );
});
test("manual VIP amount stays unchanged when original price changes", () => {
  const { page } = readyForm(fakeApi());
  page.input({ currentTarget: { dataset: { field: "priceYuan" } }, detail: { value: "150" } });
  page.preparePublish();
  assert.equal(page.data.summary.price, 150);
  assert.equal(page.data.summary.vipPrice, 89);
  assert.equal(page._confirmed.payload.vipPriceYuan, 89);
});
test("server default courts show numbered labels and campus change clears selection", () => {
  const { page } = readyForm(fakeApi());
  page.setData({
    campuses: [{ name: "未管理校区", bookingManaged: false }, { name: "空校区", bookingManaged: true }],
    courts: [1, 2].map((number) => ({ id: `default-${number}`, campus: "未管理校区", courtNumber: String(number) })),
  });
  page.chooseCampus({ detail: { value: "0" } });
  assert.deepEqual(Array.from(page.data.filteredCourts, (court) => court.label), ["1号场", "2号场"]);
  page.chooseCourt({ detail: { value: "1" } });
  page.preparePublish();
  assert.equal(page._confirmed.payload.courtId, "default-2");
  assert.equal(page.data.summary.court, "2号场");
  assert.equal(page.data.summary.managed, false);
  page.closeConfirm();
  page.chooseCampus({ detail: { value: "1" } });
  assert.equal(page.data.form.courtId, "");
  assert.equal(page.data.filteredCourts.length, 0);
});
test("template selection only overwrites title and description", () => {
  const { page } = readyForm(fakeApi());
  page.setData({
    templates: [{ id: "new", title: "发球", description: "抛球练习" }],
  });
  page.chooseTemplate({ detail: { value: "0" } });
  assert.equal(page.data.form.title, "发球");
  for (const key of [
    "date",
    "startTime",
    "endTime",
    "priceYuan",
    "vipPriceYuan",
    "minParticipants",
    "maxParticipants",
    "coachId",
    "campus",
    "courtId",
  ])
    assert.equal(page.data.form[key], form[key]);
});
test("confirmation does not call publish; timeout retry preserves frozen payload and request ID", async () => {
  const calls = [];
  const api = fakeApi({
    call: async (action, payload) => {
      calls.push({ action, payload: { ...payload } });
      if (calls.length === 1)
        throw Object.assign(new Error("网络失败"), { code: "NETWORK_ERROR" });
      return { courseId: "published-1" };
    },
  });
  const { page, storage } = readyForm(api);
  page.preparePublish();
  assert.equal(calls.length, 0);
  assert.equal(page.data.summary.vipPrice, 89);
  assert.equal(page.data.summary.duration, 90);
  await page.confirmPublish();
  assert.equal(page.data.unresolved, true);
  assert.equal(storage.has("groupCourseUnresolvedPublish"), true);
  page.input({
    currentTarget: { dataset: { field: "title" } },
    detail: { value: "不应该变更" },
  });
  assert.equal(page.data.form.title, form.title);
  await page.submitPending();
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(page.data.publishedCourseId, "published-1");
  assert.equal(page.editable(), false);
  assert.equal(storage.size, 0);
});
test("missing login keeps unresolved publish receipt; definitive conflict permits re-edit", async () => {
  let code = "AUTH_REQUIRED";
  const { page, storage } = readyForm(
    fakeApi({
      hasAuth: () => false,
      call: async () => {
        throw Object.assign(new Error(code), { code });
      },
    }),
  );
  page.preparePublish();
  await page.confirmPublish();
  const first = storage.get("groupCourseUnresolvedPublish").payload
    .publishRequestId;
  assert.equal(page.data.needsAuth, true);
  assert.equal(page.data.unresolved, true);
  code = "COURT_CONFLICT";
  await page.submitPending();
  assert.equal(page.data.unresolved, false);
  assert.ok(first);
  assert.equal(storage.size, 0);
});
test("return from confirmation does not persist a draft or dispatch", () => {
  const { page, storage } = readyForm(
    fakeApi({
      call: () => {
        throw new Error("must not run");
      },
    }),
  );
  page.preparePublish();
  page.closeConfirm();
  assert.equal(storage.size, 0);
  assert.equal(page.data.showConfirm, false);
});
test("list ignores stale filter response so old campus cannot replace new one", async () => {
  const resolvers = [];
  const { page } = loadPage(
    "groupCourse",
    fakeApi({ call: () => new Promise((resolve) => resolvers.push(resolve)) }),
  );
  page.onLoad();
  const old = page.loadList(false);
  const current = page.loadList(false);
  resolvers[1]({
    items: [],
    viewer: { authenticated: true },
    nextCursor: "new",
  });
  await current;
  resolvers[0]({
    items: [],
    viewer: { authenticated: true },
    nextCursor: "old",
  });
  await old;
  assert.equal(page.data.nextCursor, "new");
});
test("payment UI success does not mark enrollment PAID; expiry never opens payment", async () => {
  let payments = 0;
  const { page } = loadPage("groupCourseDetail", fakeApi(), {
    requestPayment: (options) => {
      payments++;
      options.success({});
    },
  });
  page.setData({
    course: { status: "PUBLISHED" },
    enrollment: { status: "PENDING_PAYMENT" },
  });
  await page.pay({ expiresAt: now + 1000, paymentParams: {} });
  assert.equal(page.data.enrollment.status, "PENDING_PAYMENT");
  await page.pay({ expiresAt: now, paymentParams: {} });
  assert.equal(payments, 1);
});
test("API shares existing phone and profile without separate authorization or token", async () => {
  const storage = new Map([["phoneNumber", "13999999999"], ["userProfile", { nickName: "学员", avatarUrl: "cloud://avatar" }]]);
  const requests = [];
  const sandbox = {
    module: { exports: {} },
    require: () => require("../utils/userProfile"),
    wx: {
      getStorageSync: key => storage.get(key),
      cloud: { callFunction: async req => { requests.push(req); return { result: { success: true, data: {} } }; } }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "utils/groupCourseApi.js"), "utf8"), sandbox);
  const api = sandbox.module.exports;
  assert.equal(api.hasAuth(), true);
  assert.equal(api.hasProfile(), true);
  await api.call("context");
  assert.equal(requests[0].data.phoneNumber, "13999999999");
  assert.equal(requests[0].data.nickName, "学员");
  assert.equal(requests[0].data.authToken, undefined);
  assert.equal(requests[0].data.phoneCode, undefined);
  storage.delete("phoneNumber");
  await api.call("context");
  assert.equal(requests[1].data.phoneNumber, "");
});
test("five text-only tabs preserve original destinations and registered pages", () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
  assert.deepEqual(
    app.tabBar.list.map((item) => item.text),
    ["首页", "场地预订", "团课", "畅打", "会员中心"],
  );
  for (const item of app.tabBar.list) {
    assert.ok(app.pages.includes(item.pagePath));
    for (const asset of [
      item.pagePath + ".js",
    ])
      assert.ok(fs.existsSync(path.join(root, asset)));
  }
  assert.match(
    fs.readFileSync(path.join(root, "pages/index/index.js"), "utf8"),
    /needSwitchCampus = true/,
  );
});

test("court display preserves descriptive identifiers", () => {
  assert.equal(view.courtLabel("1号风雨棚"), "1号风雨棚");
  assert.equal(view.courtLabel("7号室外"), "7号室外");
  assert.equal(view.courtLabel("2"), "2号场");
});
test("unresolved request cannot migrate to another authorized phone", async () => {
  let count = 0;
  const { page } = readyForm(
    fakeApi({
      call: async () => {
        count++;
        throw Object.assign(new Error("network"), { code: "NETWORK_ERROR" });
      },
    }),
  );
  page.setData({ viewer: { isAdmin: true, phoneNumber: "13800000000" } });
  page.preparePublish();
  await page.confirmPublish();
  page.setData({ viewer: { isAdmin: true, phoneNumber: "13900000000" } });
  await page.submitPending();
  assert.equal(count, 1);
  assert.equal(page.data.unresolved, true);
  assert.equal(page.data.needsAuth, false);
});

test("terminal course rejects stale pending parameters in tick and both payment entry points", async () => {
  for (const status of ["CANCELLED", "COMPLETED"]) {
    let payments = 0;
    const { page } = loadPage("groupCourseDetail", fakeApi(), {
      requestPayment: () => {
        payments++;
      },
    });
    const payment = { expiresAt: now + 120000, paymentParams: {} };
    page.setData({
      course: { status },
      enrollment: { status: "PENDING_PAYMENT", holdExpiresAt: now + 180000 },
      payment,
    });
    page.tick();
    assert.equal(page.data.canPay, false);
    await page.continuePayment();
    await page.pay(payment);
    assert.equal(payments, 0);
    assert.doesNotMatch(page.data.notice, /等待.*确认/);
  }
});
test("cancellation discovered on refresh blocks the subsequent payment call", async () => {
  let payments = 0;
  const { page } = loadPage("groupCourseDetail", fakeApi(), {
    requestPayment: () => {
      payments++;
    },
  });
  page.setData({
    course: { status: "PUBLISHED" },
    enrollment: { status: "PENDING_PAYMENT" },
    payment: { expiresAt: now + 120000, paymentParams: {} },
  });
  page.loadDetail = async () =>
    page.setData({ course: { status: "CANCELLED" } });
  await page.continuePayment();
  assert.equal(payments, 0);
});

test("existing shared login loads mine without another authorization", async () => {
  const viewer = { authenticated: true, phoneNumber: "13800000000", isAdmin: false };
  const calls = [];
  const { page } = loadPage("groupCourse", {
    hasAuth: () => true,
    call: async (action) => {
      calls.push(action);
      return action === "context" ? { viewer, campuses: [] } : { viewer, items: [], nextCursor: null };
    }, isAuthError: () => false,
  });
  page.onLoad();
  page.setData({ scope: "mine" });
  await page.refresh();
  assert.equal(page.data.needsAuth, false);
  assert.deepEqual(calls, ["context", "list"]);
});

test("missing profile uses personal center and preserves group detail destination", async () => {
  let target;
  const { page, storage } = loadPage("groupCourseDetail", {
    hasAuth: () => true, hasProfile: () => false,
  }, { switchTab: ({ url }) => { target = url; } });
  page.setData({ courseId: "course-to-return", course: { canEnroll: true } });
  await page.enroll();
  assert.equal(target, "/pages/member/member");
  assert.equal(storage.get("postLoginRedirect").courseId, "course-to-return");
});

test("mine uses current phone even before context returns or with a stale guest viewer", async () => {
  let count = 0;
  const { page } = loadPage("groupCourse", fakeApi({
    call: async () => {
      count++;
      return { viewer: { authenticated: true }, items: [], nextCursor: null };
    },
  }));
  page.onLoad();
  page.setData({ scope: "mine", viewer: { authenticated: false }, needsAuth: true });
  await page.loadList(false);
  assert.equal(count, 1);
  assert.equal(page.data.needsAuth, false);
  page.showError({ code: "AUTH_REQUIRED", message: "server rejected" });
  assert.equal(page.data.needsAuth, false);
});

test("phone present plus guest server response is a service mismatch, never a login prompt", async () => {
  const sandbox = {
    module: { exports: {} },
    require: () => require("../utils/userProfile"),
    wx: {
      getStorageSync: key => key === "phoneNumber" ? "13800000000" : null,
      cloud: { callFunction: async () => ({ result: { success: true, data: { viewer: { authenticated: false } } } }) },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "utils/groupCourseApi.js"), "utf8"), sandbox);
  const api = sandbox.module.exports;
  await assert.rejects(() => api.call("context"), error => error.code === "LOGIN_CONTRACT_MISMATCH" && !api.isAuthError(error));
  assert.equal(api.hasAuth(), true);
});

test("global manager entry survives context failure and follows permission revocation", async () => {
  let allowed = true;
  const { page } = loadPage("groupCourse", fakeApi({
    canCreateCourse: () => allowed,
    call: async () => { throw Object.assign(new Error("会员查询不可用"), { code: "VIP_UNAVAILABLE" }); },
  }));
  page.onLoad();
  page.syncCreatePermission();
  await page.refresh();
  assert.equal(page.data.canCreate, true);
  assert.match(page.data.error, /会员查询/);
  allowed = false;
  page.syncCreatePermission();
  assert.equal(page.data.canCreate, false);
});

test("create entry reads current phone against shared rush and special manager lists", () => {
  let phone = "13800000000";
  const globalData = { courtRushManagerList: [phone], specialManagerList: [] };
  const sandbox = {
    module: { exports: {} },
    require: () => require("../utils/userProfile"),
    getApp: () => ({ globalData }),
    wx: { getStorageSync: key => key === "phoneNumber" ? phone : null },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "utils/groupCourseApi.js"), "utf8"), sandbox);
  const api = sandbox.module.exports;
  assert.equal(api.canCreateCourse(), true);
  phone = "13900000000";
  assert.equal(api.canCreateCourse(), false);
  globalData.specialManagerList = [phone];
  assert.equal(api.canCreateCourse(), true);
});

test("group responses cannot override unified manager permissions on list and form", async () => {
  for (const allowed of [true, false]) {
    const remoteViewer = { authenticated: true, isAdmin: !allowed };
    const api = fakeApi({
      canCreateCourse: () => allowed,
      call: async action => action === "context"
        ? { viewer: remoteViewer, campuses: [], courts: [], coaches: [], templates: [] }
        : { viewer: remoteViewer, items: [], nextCursor: null },
    });
    const { page: list } = loadPage("groupCourse", api);
    list.onLoad();
    await list.refresh();
    assert.equal(list.data.canCreate, allowed);
    const { page: formPage } = loadPage("groupCourseForm", api);
    await formPage.loadContext();
    assert.equal(formPage.data.canManage, allowed);
  }
});

test("VIP amount returned by enrollment is shown before WeChat payment", async () => {
  const dialogs = [];
  let payments = 0;
  const { page } = loadPage("groupCourseDetail", fakeApi({
    hasProfile: () => true,
    call: async () => ({ enrollment: { id: "e", status: "PENDING_PAYMENT", actualFeeYuan: 80, isVip: true }, payment: { expiresAt: now + 120000, paymentParams: {} } }),
  }), {
    showModal: options => { dialogs.push(options.content); options.success({ confirm: true }); },
    requestPayment: options => { assert.equal(dialogs.length, 2); assert.match(dialogs[1], /80/); payments++; options.success({}); },
  });
  page.setData({ courseId: "c", viewer: { phoneNumber: "13800000000" }, course: { status: "PUBLISHED", canEnroll: true, title: "课程", actualFeeYuan: 100 } });
  page.loadDetail = async () => {};
  await page.enroll();
  assert.equal(payments, 1);
  assert.equal(page.data.enrollment.actualFeeYuan, 80);
});
