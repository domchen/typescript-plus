//// [computedPropertyNames34_ES5.ts]
function foo<T>() { return '' }
class C<T> {
    static bar() {
        var obj = {
            [foo<T>()]() { }
        };
        return 0;
    }
}

//// [computedPropertyNames34_ES5.js]
function foo() { return ''; }
var C = /** @class */ (function () {
    function C() {
    }
    C.bar = function () {
        var _a;
        var obj = (_a = {},
            _a[foo()] = function () { },
            _a);
        return 0;
    };
    return C;
}());
