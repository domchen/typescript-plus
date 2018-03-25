//// [mappedTypePartialConstraints.ts]
// Repro from #16985

interface MyInterface {
  something: number;
}

class MyClass<T extends MyInterface> {
  doIt(data : Partial<T>) {}
}

class MySubClass extends MyClass<MyInterface> {}

function fn(arg: typeof MyClass) {};

fn(MySubClass);


//// [mappedTypePartialConstraints.js]
// Repro from #16985
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
var MyClass = /** @class */ (function () {
    function MyClass() {
    }
    MyClass.prototype.doIt = function (data) { };
    return MyClass;
}());
var MySubClass = /** @class */ (function (_super) {
    __extends(MySubClass, _super);
    function MySubClass() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    return MySubClass;
}(MyClass));
function fn(arg) { }
;
fn(MySubClass);
