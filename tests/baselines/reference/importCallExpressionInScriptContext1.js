//// [tests/cases/conformance/dynamicImport/importCallExpressionInScriptContext1.ts] ////

//// [0.ts]
export function foo() { return "foo"; }

//// [1.ts]
var p1 = import("./0");
function arguments() { } // this is allow as the file doesn't have implicit "use strict"

//// [0.js]
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function foo() { return "foo"; }
exports.foo = foo;
//// [1.js]
var p1 = Promise.resolve().then(function () { return require("./0"); });
function arguments() { } // this is allow as the file doesn't have implicit "use strict"
