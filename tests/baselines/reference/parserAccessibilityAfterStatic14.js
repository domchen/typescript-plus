//// [parserAccessibilityAfterStatic14.ts]
class Outer
{
static public<T>() {}
}


//// [parserAccessibilityAfterStatic14.js]
var Outer = /** @class */ (function () {
    function Outer() {
    }
    Outer.public = function () { };
    return Outer;
}());
