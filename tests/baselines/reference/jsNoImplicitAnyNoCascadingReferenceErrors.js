//// [tests/cases/compiler/jsNoImplicitAnyNoCascadingReferenceErrors.ts] ////

//// [somelib.d.ts]
export declare class Foo<T> {
    prop: T;
}
//// [index.js]
import {Foo} from "./somelib";

class MyFoo extends Foo {
    constructor() {
        super();
        this.prop.alpha = 12;
    }
}


//// [index.js]
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
exports.__esModule = true;
var somelib_1 = require("./somelib");
var MyFoo = /** @class */ (function (_super) {
    __extends(MyFoo, _super);
    function MyFoo() {
        var _this = _super.call(this) || this;
        _this.prop.alpha = 12;
        return _this;
    }
    return MyFoo;
}(somelib_1.Foo));
