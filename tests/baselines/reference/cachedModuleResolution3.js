//// [tests/cases/compiler/cachedModuleResolution3.ts] ////

//// [foo.d.ts]

export declare let x: number

//// [app.ts]
import {x} from "foo";

//// [lib.ts]
import {x} from "foo";

//// [app.js]
"use strict";
//// [lib.js]
"use strict";
