//// [declarationEmitConstantNoWidening.ts]
export const FOO = 'FOO'; 
export class Bar {
    readonly type = FOO; // Should be widening literal "FOO" - so either `typeof "FOO"` or = "FOO"
}

//// [declarationEmitConstantNoWidening.js]
"use strict";
exports.__esModule = true;
exports.FOO = 'FOO';
var Bar = /** @class */ (function () {
    function Bar() {
        this.type = exports.FOO; // Should be widening literal "FOO" - so either `typeof "FOO"` or = "FOO"
    }
    return Bar;
}());
exports.Bar = Bar;


//// [declarationEmitConstantNoWidening.d.ts]
export declare const FOO = "FOO";
export declare class Bar {
    readonly type = "FOO";
}
