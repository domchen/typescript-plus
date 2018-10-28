//// [destructureComputedProperty.ts]
declare const ab: { n: number } | { n: string };
const nameN = "n";
const { [nameN]: n } = ab;

class C { private p: number; }
const nameP = "p";
const { "p": p0 } = new C();
const { ["p"]: p1 } = new C();
const { [nameP]: p2 } = new C();
const { p: p3 } = new C();


//// [destructureComputedProperty.js]
var nameN = "n";
var _a = nameN, n = ab[_a];
var C = /** @class */ (function () {
    function C() {
    }
    return C;
}());
var nameP = "p";
var p0 = new C()["p"];
var p1 = new C()["p"];
var _b = nameP, p2 = new C()[_b];
var p3 = new C().p;
