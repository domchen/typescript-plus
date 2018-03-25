//// [jsxHasLiteralType.tsx]
import * as React from "react";

interface Props {
    x?: "a" | "b";
}
class MyComponent<P extends Props = Props> extends React.Component<P, {}> {}
const m = <MyComponent x="a"/>


//// [jsxHasLiteralType.js]
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
var React = require("react");
var MyComponent = /** @class */ (function (_super) {
    __extends(MyComponent, _super);
    function MyComponent() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    return MyComponent;
}(React.Component));
var m = React.createElement(MyComponent, { x: "a" });
