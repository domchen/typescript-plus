//// [tests/cases/compiler/moduleResolution_explicitNodeModulesImport_implicitAny.ts] ////

//// [index.js]
exports.x = 0;

//// [index.ts]
import { y } from "../node_modules/foo";


//// [index.js]
"use strict";
exports.__esModule = true;
