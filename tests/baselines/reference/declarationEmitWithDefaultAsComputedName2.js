//// [tests/cases/compiler/declarationEmitWithDefaultAsComputedName2.ts] ////

//// [other.ts]
type Experiment<Name> = {
    name: Name;
};
declare const createExperiment: <Name extends string>(
    options: Experiment<Name>
) => Experiment<Name>;
export default createExperiment({
    name: "foo"
});

//// [main.ts]
import * as other2 from "./other";
export const obj = {
    [other2.default.name]: 1
};

//// [other.js]
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = createExperiment({
    name: "foo"
});
//// [main.js]
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var _a;
var other2 = require("./other");
exports.obj = (_a = {},
    _a[other2.default.name] = 1,
    _a);


//// [other.d.ts]
declare type Experiment<Name> = {
    name: Name;
};
declare const _default: Experiment<"foo">;
export default _default;
//// [main.d.ts]
import * as other2 from "./other";
export declare const obj: {
    [other2.default.name]: number;
};
