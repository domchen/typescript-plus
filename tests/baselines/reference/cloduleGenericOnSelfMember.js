//// [cloduleGenericOnSelfMember.ts]
class ServiceBase<T> {
    field: T;
}
class Service extends ServiceBase<typeof Service.Base> {
}
namespace Service {
    export const Base = {
        name: "1",
        value: 5
    };
}

//// [cloduleGenericOnSelfMember.js]
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
var ServiceBase = /** @class */ (function () {
    function ServiceBase() {
    }
    return ServiceBase;
}());
var Service = /** @class */ (function (_super) {
    __extends(Service, _super);
    function Service() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    return Service;
}(ServiceBase));
(function (Service) {
    Service.Base = {
        name: "1",
        value: 5
    };
})(Service || (Service = {}));
