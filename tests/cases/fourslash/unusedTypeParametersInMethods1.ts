/// <reference path='fourslash.ts' />

// @noUnusedLocals: true
//// class A {
////     [|public f1<X, Y, Z>(a: X)|] { a; var b: Z; b }
//// }

verify.codeFix({
    description: "Remove declaration for: 'Y'",
    newRangeContent: "public f1<X, Z>(a: X)",
});
