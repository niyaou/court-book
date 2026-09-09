"use strict";
const { runtime, context } = require("./lib/runtime");
exports.main = (event) => runtime().paymentCallback(event, context());
