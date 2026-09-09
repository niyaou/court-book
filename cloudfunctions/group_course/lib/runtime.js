"use strict";
const cloud = require("wx-server-sdk");
const { createVipLookup } = require("./memberVip");
const { createRepository } = require("./repository");
const { createGateway } = require("./gateway");
const { createService } = require("./service");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
function runtime() {
  return createService({
    repo: createRepository(cloud.database()),
    gateway: createGateway(cloud),
    vip: createVipLookup(cloud),
  });
}
module.exports = { runtime, context: () => cloud.getWXContext() };
