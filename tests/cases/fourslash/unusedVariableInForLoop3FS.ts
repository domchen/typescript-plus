/// <reference path='fourslash.ts' />

// @noUnusedLocals: true
//// function f1 () {
////     [|for(var i = 0, j= 0, k=0; ;i++, k++)|] {
////
////     }
//// }

verify.codeFix({
    description: "Remove declaration for: 'j'",
    newRangeContent: "for(var i = 0, k=0; ;i++, k++)",
});
