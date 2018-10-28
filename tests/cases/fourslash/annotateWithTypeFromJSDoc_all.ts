/// <reference path='fourslash.ts' />

// @Filename: test123.ts
/////** @type {number} */
////var [|x|];
/////** @type {string} */
////var [|y|];

verify.codeFixAll({
    fixId: "annotateWithTypeFromJSDoc",
    fixAllDescription: "Annotate everything with types from JSDoc",
    newFileContent:
`/** @type {number} */
var x: number;
/** @type {string} */
var y: string;`,
});
