//// [ES5For-of36.ts]
for (let [a = 0, b = 1] of [2, 3]) {
    a;
    b;
}

//// [ES5For-of36.js]
var __values = (this && this.__values) || function (o) {
    var m = typeof Symbol === "function" && o[Symbol.iterator], i = 0;
    if (m) return m.call(o);
    return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
};
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var e_1, _a;
try {
    for (var _b = __values([2, 3]), _c = _b.next(); !_c.done; _c = _b.next()) {
        var _d = __read(_c.value, 2), _e = _d[0], a = _e === void 0 ? 0 : _e, _f = _d[1], b = _f === void 0 ? 1 : _f;
        a;
        b;
    }
}
catch (e_1_1) { e_1 = { error: e_1_1 }; }
finally {
    try {
        if (_c && !_c.done && (_a = _b["return"])) _a.call(_b);
    }
    finally { if (e_1) throw e_1.error; }
}
//# sourceMappingURL=ES5For-of36.js.map