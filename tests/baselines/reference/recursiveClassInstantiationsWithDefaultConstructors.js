//// [recursiveClassInstantiationsWithDefaultConstructors.ts]
var a = new TypeScript2.MemberNameArray()
module TypeScript2 {
export class MemberName {
public prefix: string = "";
}
export class MemberNameArray extends MemberName {
}
}


//// [recursiveClassInstantiationsWithDefaultConstructors.js]
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var a = new TypeScript2.MemberNameArray();
var TypeScript2;
(function (TypeScript2) {
    var MemberName = (function () {
        function MemberName() {
            this.prefix = "";
        }
        return MemberName;
    }());
    TypeScript2.MemberName = MemberName;
    var MemberNameArray = (function (_super) {
        __extends(MemberNameArray, _super);
        function MemberNameArray() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        return MemberNameArray;
    }(MemberName));
    TypeScript2.MemberNameArray = MemberNameArray;
})(TypeScript2 || (TypeScript2 = {}));
