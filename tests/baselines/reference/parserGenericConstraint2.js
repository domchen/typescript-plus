//// [parserGenericConstraint2.ts]
class C<T extends List<T> > {
}

//// [parserGenericConstraint2.js]
var C = /** @class */ (function () {
    function C() {
    }
    return C;
}());
