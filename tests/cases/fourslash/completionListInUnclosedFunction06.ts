﻿/// <reference path="fourslash.ts" />

////function foo(x: string, y: number, z: boolean) {
////    function bar(a: number, b: string = /*1*/, c: typeof x = "hello"
////

// Note: Ideally `c` wouldn't be included since it hasn't been initialized yet.
verify.completions({ marker: "1", includes: ["foo", "x", "y", "z", "bar", "a", "b", "c"]})
