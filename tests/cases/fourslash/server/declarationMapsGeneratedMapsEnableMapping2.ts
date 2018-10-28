/// <reference path="../fourslash.ts" />

// @Filename: /tsconfig.json
////{
////    "compilerOptions": {
////        "outDir": "./dist",
////        "sourceMap": true,
////        "sourceRoot": "/",
////        "declaration": true,
////        "declarationMap": true,
////        "newLine": "lf",
////    },
////    "files": ["/index.ts"],
////}

// @Filename: /index.ts
// @emitThisFile: true
////export class Foo {
////    member: string;
////    /*2*/methodName(propName: SomeType): SomeType { return propName; }
////    otherMethod() {
////        if (Math.random() > 0.5) {
////            return {x: 42};
////        }
////        return {y: "yes"};
////    }
////}
////
////export interface /*SomeType*/SomeType {
////    member: number;
////}

// @Filename: /mymodule.ts
////import * as mod from "/dist/index";
////const instance = new mod.Foo();
////instance.[|/*1*/methodName|]({member: 12});

// @Filename: /dist/index.js.map
////{"version":3,"file":"index.js","sourceRoot":"/","sources":["index.ts"],"names":[],"mappings":";;AAAA;IAAA;IASA,CAAC;IAPG,wBAAU,GAAV,UAAW,QAAkB,IAAc,OAAO,QAAQ,CAAC,CAAC,CAAC;IAC7D,yBAAW,GAAX;QACI,IAAI,IAAI,CAAC,MAAM,EAAE,GAAG,GAAG,EAAE;YACrB,OAAO,EAAC,CAAC,EAAE,EAAE,EAAC,CAAC;SAClB;QACD,OAAO,EAAC,CAAC,EAAE,KAAK,EAAC,CAAC;IACtB,CAAC;IACL,UAAC;AAAD,CAAC,AATD,IASC;AATY,kBAAG"}

// @Filename: /dist/index.js
////"use strict";
////exports.__esModule = true;
////var Foo = /** @class */ (function () {
////    function Foo() {
////    }
////    Foo.prototype.methodName = function (propName) { return propName; };
////    Foo.prototype.otherMethod = function () {
////        if (Math.random() > 0.5) {
////            return { x: 42 };
////        }
////        return { y: "yes" };
////    };
////    return Foo;
////}());
////exports.Foo = Foo;
//////# sourceMappingURL=index.js.map

// @Filename: /dist/index.d.ts.map
////{"version":3,"file":"index.d.ts","sourceRoot":"/","sources":["index.ts"],"names":[],"mappings":"AAAA,qBAAa,GAAG;IACZ,MAAM,EAAE,MAAM,CAAC;IACf,UAAU,CAAC,QAAQ,EAAE,QAAQ,GAAG,QAAQ;IACxC,WAAW;;;;;;;CAMd;AAED,MAAM,WAAW,QAAQ;IACrB,MAAM,EAAE,MAAM,CAAC;CAClB"}

// @Filename: /dist/index.d.ts
////export declare class Foo {
////    member: string;
////    methodName(propName: SomeType): SomeType;
////    otherMethod(): {
////        x: number;
////        y?: undefined;
////    } | {
////        y: string;
////        x?: undefined;
////    };
////}
////export interface SomeType {
////    member: number;
////}
//////# sourceMappingURL=index.d.ts.map

goTo.file("/index.ts");
verify.getEmitOutput(["/dist/index.js.map", "/dist/index.js", "/dist/index.d.ts.map", "/dist/index.d.ts"]);

verify.goToDefinition("1", "2"); // getDefinitionAndBoundSpan
verify.goToType("1", "SomeType"); // getTypeDefinitionAtPosition
goTo.marker("1");
verify.goToDefinitionIs("2"); // getDefinitionAtPosition
goTo.implementation(); // getImplementationAtPosition
verify.caretAtMarker("2");
