//// [parserConstructorDeclaration8.ts]
class C {
  // Not a constructor
  public constructor;
}

//// [parserConstructorDeclaration8.js]
var C = /** @class */ (function () {
    function C() {
    }
    return C;
}());
