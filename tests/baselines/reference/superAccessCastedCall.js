//// [superAccessCastedCall.ts]
class Foo {
    bar(): void {}
}

class Bar extends Foo {
    x: Number;

    constructor() {
        super();
        this.x = 2;
    }

    bar() {
        super.bar();
        (super.bar as any)();
    }
} 

let b = new Bar();
b.bar()

//// [superAccessCastedCall.js]
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
var Foo = /** @class */ (function () {
    function Foo() {
    }
    Foo.prototype.bar = function () { };
    return Foo;
}());
var Bar = /** @class */ (function (_super) {
    __extends(Bar, _super);
    function Bar() {
        var _this = _super.call(this) || this;
        _this.x = 2;
        return _this;
    }
    Bar.prototype.bar = function () {
        _super.prototype.bar.call(this);
        _super.prototype.bar.call(this);
    };
    return Bar;
}(Foo));
var b = new Bar();
b.bar();
