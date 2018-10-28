/// <reference path='fourslash.ts' />

/////**
//// * @param {number} x
//// * @returns {number}
//// */
////var f = function (x) {
////    return x
////}

verify.codeFix({
    description: "Annotate with type from JSDoc",
    newFileContent:
`/**
 * @param {number} x
 * @returns {number}
 */
var f = function (x: number): number {
    return x
}`,
});
