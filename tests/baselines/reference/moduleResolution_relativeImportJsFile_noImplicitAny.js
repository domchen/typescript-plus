//// [tests/cases/compiler/moduleResolution_relativeImportJsFile_noImplicitAny.ts] ////

//// [b.js]
export const x = 0;

//// [a.ts]
import * as b from "./b";


//// [a.js]
"use strict";
exports.__esModule = true;
