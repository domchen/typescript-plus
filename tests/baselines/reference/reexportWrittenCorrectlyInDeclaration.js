//// [tests/cases/compiler/reexportWrittenCorrectlyInDeclaration.ts] ////

//// [ThingA.ts]
// https://github.com/Microsoft/TypeScript/issues/8612
export class ThingA { } 

//// [ThingB.ts]
export class ThingB { }

//// [Things.ts]
export {ThingA} from "./ThingA";
export {ThingB} from "./ThingB";

//// [Test.ts]
import * as things from "./Things";

export class Test {
    public method = (input: things.ThingA)  => { };
}

//// [ThingA.js]
"use strict";
exports.__esModule = true;
// https://github.com/Microsoft/TypeScript/issues/8612
var ThingA = /** @class */ (function () {
    function ThingA() {
    }
    return ThingA;
}());
exports.ThingA = ThingA;
//// [ThingB.js]
"use strict";
exports.__esModule = true;
var ThingB = /** @class */ (function () {
    function ThingB() {
    }
    return ThingB;
}());
exports.ThingB = ThingB;
//// [Things.js]
"use strict";
exports.__esModule = true;
var ThingA_1 = require("./ThingA");
exports.ThingA = ThingA_1.ThingA;
var ThingB_1 = require("./ThingB");
exports.ThingB = ThingB_1.ThingB;
//// [Test.js]
"use strict";
exports.__esModule = true;
var Test = /** @class */ (function () {
    function Test() {
        this.method = function (input) { };
    }
    return Test;
}());
exports.Test = Test;


//// [ThingA.d.ts]
export declare class ThingA {
}
//// [ThingB.d.ts]
export declare class ThingB {
}
//// [Things.d.ts]
export { ThingA } from "./ThingA";
export { ThingB } from "./ThingB";
//// [Test.d.ts]
import * as things from "./Things";
export declare class Test {
    method: (input: things.ThingA) => void;
}
