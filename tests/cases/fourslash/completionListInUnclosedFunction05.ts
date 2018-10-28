﻿/// <reference path="fourslash.ts" />

////function foo(x: string, y: number, z: boolean) {
////    function bar(a: number, b: string, c: typeof x = /*1*/
////}

// Note: Ideally `c` wouldn't be included since it hasn't been initialized yet.
verify.completions({ marker: "1", includes: ["foo", "x", "y", "z", "bar", "a", "b", "c"]})
