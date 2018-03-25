/// <reference path='fourslash.ts' />

// @noUnusedLocals: true
//// class A<T> {
////    public x: T;
//// }
//// [|var y: new <T,U>(a:T)=>void;|]

verify.codeFix({
    description: "Remove declaration for: 'U'",
    newRangeContent: "var y: new <T>(a:T)=>void;",
});
