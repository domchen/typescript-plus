//// [tests/cases/compiler/requireOfJsonFileWithModuleEmitNone.ts] ////

//// [file1.ts]
import * as b from './b.json';

//// [b.json]
{
    "a": true,
    "b": "hello"
}

//// [out/file1.js]
"use strict";
exports.__esModule = true;
