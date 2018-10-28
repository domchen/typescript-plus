//// [objectLiteralComputedNameNoDeclarationError.ts]
const Foo = {
    BANANA: 'banana' as 'banana',
}

export const Baa = {
    [Foo.BANANA]: 1
};

//// [objectLiteralComputedNameNoDeclarationError.js]
"use strict";
exports.__esModule = true;
var _a;
var Foo = {
    BANANA: 'banana'
};
exports.Baa = (_a = {},
    _a[Foo.BANANA] = 1,
    _a);


//// [objectLiteralComputedNameNoDeclarationError.d.ts]
declare const Foo: {
    BANANA: "banana";
};
export declare const Baa: {
    [Foo.BANANA]: number;
};
export {};
