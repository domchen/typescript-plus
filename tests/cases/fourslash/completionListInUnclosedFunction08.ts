﻿/// <reference path="fourslash.ts" />

////function foo(x: string, y: number, z: boolean) {
////    function bar(a: number, b: string = "hello", c: typeof x = "hello") {
////        var v = /*1*/

// Note: "v" questionable since we're in its initializer
verify.completions({ marker: "1", includes: ["foo", "x", "y", "z", "bar", "a", "b", "c", "v"], isNewIdentifierLocation: true });
