"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _lessVarsToJs = require("./less-vars-to-js");

Object.keys(_lessVarsToJs).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _lessVarsToJs[key];
    }
  });
});