//// [0.js]
// @ts-check

/** @type {function (number)} */
const x1 = (a) => a + 1;
x1("string");

/** @type {function (number): number} */
const x2 = (a) => a + 1;

/** @type {string} */
var a;
a = x2(0);

//// [0.js]
// @ts-check
/** @type {function (number)} */
var x1 = function (a) { return a + 1; };
x1("string");
/** @type {function (number): number} */
var x2 = function (a) { return a + 1; };
/** @type {string} */
var a;
a = x2(0);
