/// <reference path='fourslash.ts' />

// @Filename: /a.js
/////*0*/
////function f(a, ...b): boolean {}

verify.docCommentTemplateAt("0", 8,
`/**
 * 
 * @param {any} a
 * @param {...any} b
 */`);
