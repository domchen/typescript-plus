/// <reference path='fourslash.ts' />

// Tests that tokens found on the default library are not renamed.
// "test" is a comment on the default library.

// @Filename: file1.ts
//// var [|test|] = "foo";
//// console.log([|test|]);

const ranges = test.ranges();
verify.renameLocations(ranges[0], { findInComments: true, ranges });