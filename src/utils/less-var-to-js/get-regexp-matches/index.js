"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _getRegexpMatches = require("./getRegexpMatches");

Object.keys(_getRegexpMatches).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _getRegexpMatches[key];
    }
  });
});