/// <reference path='fourslash.ts' />

// @allowJs: true
// @target: esnext

// @Filename: /a.js
////const x = require("x");
////x.y;

verify.codeFix({
    description: "Convert to ES6 module",
    newFileContent:
`import { y } from "x";
y;`,
});
