"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _loadAndResolveLessVars = require("./loadAndResolveLessVars");

Object.keys(_loadAndResolveLessVars).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _loadAndResolveLessVars[key];
    }
  });
});