//// [parserClassDeclaration2.ts]
class C implements A implements B {
}

//// [parserClassDeclaration2.js]
var C = /** @class */ (function () {
    function C() {
    }
    return C;
}());
