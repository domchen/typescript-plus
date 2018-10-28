//// [abstractPropertyInConstructor.ts]
abstract class AbstractClass {
    constructor(str: string, other: AbstractClass) {
        this.method(parseInt(str));
        let val = this.prop.toLowerCase();

        if (!str) {
            this.prop = "Hello World";
        }
        this.cb(str);

        // OK, reference is inside function
        const innerFunction = () => {
            return this.prop;
        }

        // OK, references are to another instance
        other.cb(other.prop);
    }

    abstract prop: string;
    abstract cb: (s: string) => void;

    abstract method(num: number): void;

    other = this.prop;
    fn = () => this.prop;

    method2() {
        this.prop = this.prop + "!";
    }
}

abstract class DerivedAbstractClass extends AbstractClass {
    cb = (s: string) => {};

    constructor(str: string, other: AbstractClass, yetAnother: DerivedAbstractClass) {
        super(str, other);
        // there is no implementation of 'prop' in any base class
        this.cb(this.prop.toLowerCase());

        this.method(1);

        // OK, references are to another instance
        other.cb(other.prop);
        yetAnother.cb(yetAnother.prop);
    }
}

class Implementation extends DerivedAbstractClass {
    prop = "";
    cb = (s: string) => {};

    constructor(str: string, other: AbstractClass, yetAnother: DerivedAbstractClass) {
        super(str, other, yetAnother);
        this.cb(this.prop);
    }

    method(n: number) {
        this.cb(this.prop + n);
    }
}

class User {
    constructor(a: AbstractClass) {
        a.prop;
        a.cb("hi");
        a.method(12);
        a.method2();
    }
}


//// [abstractPropertyInConstructor.js]
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
        return extendStatics(d, b);
    }
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var AbstractClass = /** @class */ (function () {
    function AbstractClass(str, other) {
        var _this = this;
        this.other = this.prop;
        this.fn = function () { return _this.prop; };
        this.method(parseInt(str));
        var val = this.prop.toLowerCase();
        if (!str) {
            this.prop = "Hello World";
        }
        this.cb(str);
        // OK, reference is inside function
        var innerFunction = function () {
            return _this.prop;
        };
        // OK, references are to another instance
        other.cb(other.prop);
    }
    AbstractClass.prototype.method2 = function () {
        this.prop = this.prop + "!";
    };
    return AbstractClass;
}());
var DerivedAbstractClass = /** @class */ (function (_super) {
    __extends(DerivedAbstractClass, _super);
    function DerivedAbstractClass(str, other, yetAnother) {
        var _this = _super.call(this, str, other) || this;
        _this.cb = function (s) { };
        // there is no implementation of 'prop' in any base class
        _this.cb(_this.prop.toLowerCase());
        _this.method(1);
        // OK, references are to another instance
        other.cb(other.prop);
        yetAnother.cb(yetAnother.prop);
        return _this;
    }
    return DerivedAbstractClass;
}(AbstractClass));
var Implementation = /** @class */ (function (_super) {
    __extends(Implementation, _super);
    function Implementation(str, other, yetAnother) {
        var _this = _super.call(this, str, other, yetAnother) || this;
        _this.prop = "";
        _this.cb = function (s) { };
        _this.cb(_this.prop);
        return _this;
    }
    Implementation.prototype.method = function (n) {
        this.cb(this.prop + n);
    };
    return Implementation;
}(DerivedAbstractClass));
var User = /** @class */ (function () {
    function User(a) {
        a.prop;
        a.cb("hi");
        a.method(12);
        a.method2();
    }
    return User;
}());
