//// [emitClassExpressionInDeclarationFile.ts]
export var simpleExample = class {
    static getTags() { }
    tags() { }
}
export var circularReference = class C {
    static getTags(c: C): C { return c }
    tags(c: C): C { return c }
}

// repro from #15066
export class FooItem {
    foo(): void { }
    name?: string;
}

export type Constructor<T> = new(...args: any[]) => T;
export function WithTags<T extends Constructor<FooItem>>(Base: T) {
    return class extends Base {
        static getTags(): void { }
        tags(): void { }
    }
}

export class Test extends WithTags(FooItem) {}

const test = new Test();

Test.getTags()
test.tags();


//// [emitClassExpressionInDeclarationFile.js]
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
exports.__esModule = true;
exports.simpleExample = (function () {
    function class_1() {
    }
    class_1.getTags = function () { };
    class_1.prototype.tags = function () { };
    return class_1;
}());
exports.circularReference = (function () {
    function C() {
    }
    C.getTags = function (c) { return c; };
    C.prototype.tags = function (c) { return c; };
    return C;
}());
// repro from #15066
var FooItem = (function () {
    function FooItem() {
    }
    FooItem.prototype.foo = function () { };
    return FooItem;
}());
exports.FooItem = FooItem;
function WithTags(Base) {
    return (function (_super) {
        __extends(class_2, _super);
        function class_2() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        class_2.getTags = function () { };
        class_2.prototype.tags = function () { };
        return class_2;
    }(Base));
}
exports.WithTags = WithTags;
var Test = (function (_super) {
    __extends(Test, _super);
    function Test() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    return Test;
}(WithTags(FooItem)));
exports.Test = Test;
var test = new Test();
Test.getTags();
test.tags();


//// [emitClassExpressionInDeclarationFile.d.ts]
export declare var simpleExample: {
    new (): {
        tags(): void;
    };
    getTags(): void;
};
export declare var circularReference: {
    new (): {
        tags(c: any): any;
    };
    getTags(c: {
        tags(c: any): any;
    }): {
        tags(c: any): any;
    };
};
export declare class FooItem {
    foo(): void;
    name?: string;
}
export declare type Constructor<T> = new (...args: any[]) => T;
export declare function WithTags<T extends Constructor<FooItem>>(Base: T): {
    new (...args: any[]): {
        tags(): void;
        foo(): void;
        name?: string;
    };
    getTags(): void;
} & T;
declare const Test_base: {
    new (...args: any[]): {
        tags(): void;
        foo(): void;
        name?: string;
    };
    getTags(): void;
} & typeof FooItem;
export declare class Test extends Test_base {
}
