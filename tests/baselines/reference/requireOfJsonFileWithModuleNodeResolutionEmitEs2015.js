//// [tests/cases/compiler/requireOfJsonFileWithModuleNodeResolutionEmitEs2015.ts] ////

//// [file1.ts]
import * as b from './b.json';

//// [b.json]
{
    "a": true,
    "b": "hello"
}

//// [out/b.json]
{
    "a": true,
    "b": "hello"
}
//// [out/file1.js]
