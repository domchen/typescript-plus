//// [thisTypeAccessibility.ts]
class MyClass {
    private p: number = 123;
    protected pp: number = 123;
    public ppp: number = 123;
    private static sp: number = 123;
    protected static spp: number = 123;
    public static sppp: number = 123;
}

interface MyClass {
    extension1(p: number): void;
    extension2(p: number): void;
    extension3(p: number): void;
}

MyClass.prototype.extension1 = function (this: MyClass, p: number) { 
    this.p = p;
    this.pp = p;
    this.ppp = p;
    MyClass.sp = p;
    MyClass.spp = p;
    MyClass.sppp = p;
}

MyClass.prototype.extension2 = function<T extends MyClass> (this: T, p: number) { 
    this.p = p;
    this.pp = p;
    this.ppp = p;
    MyClass.sp = p;
    MyClass.spp = p;
    MyClass.sppp = p;
}

function extension3<T extends MyClass> (this: T, p: number) { 
    this.p = p;
    this.pp = p;
    this.ppp = p;
    MyClass.sp = p;
    MyClass.spp = p;
    MyClass.sppp = p;
}

MyClass.prototype.extension3 = extension3;


//// [thisTypeAccessibility.js]
var MyClass = /** @class */ (function () {
    function MyClass() {
        this.p = 123;
        this.pp = 123;
        this.ppp = 123;
    }
    MyClass.sp = 123;
    MyClass.spp = 123;
    MyClass.sppp = 123;
    return MyClass;
}());
MyClass.prototype.extension1 = function (p) {
    this.p = p;
    this.pp = p;
    this.ppp = p;
    MyClass.sp = p;
    MyClass.spp = p;
    MyClass.sppp = p;
};
MyClass.prototype.extension2 = function (p) {
    this.p = p;
    this.pp = p;
    this.ppp = p;
    MyClass.sp = p;
    MyClass.spp = p;
    MyClass.sppp = p;
};
function extension3(p) {
    this.p = p;
    this.pp = p;
    this.ppp = p;
    MyClass.sp = p;
    MyClass.spp = p;
    MyClass.sppp = p;
}
MyClass.prototype.extension3 = extension3;
