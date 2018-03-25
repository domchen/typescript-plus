/// <reference path='fourslash.ts' />

// @allowjs: true
// @checkJs: true
// @noEmit: true

// @Filename: a.js
////let x = "";
////x = 1;
////x = true;

verify.codeFixAll({
    fixId: "disableJsDiagnostics",
    newFileContent:
`let x = "";
// @ts-ignore
x = 1;
// @ts-ignore
x = true;`,
});
