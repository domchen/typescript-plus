/// <reference path='fourslash.ts' />

// @noUnusedLocals: true
//// class C1 {
////    [|f1<T extends number>()|] {}
//// }

verify.codeFix({
    description: "Remove declaration for: 'T'",
    newRangeContent: "f1()",
});
