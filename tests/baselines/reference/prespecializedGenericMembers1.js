//// [prespecializedGenericMembers1.ts]
export interface IKitty {

    }

export class Cat<CatType extends IKitty> {
    constructor() {
    
    }
}

export class CatBag {
    constructor(cats: { barry: Cat<IKitty>; }) {
        
    }
}
var cat = new Cat<IKitty>();
var catThing = {
    barry: cat
};
var catBag = new CatBag(catThing);

//// [prespecializedGenericMembers1.js]
"use strict";
exports.__esModule = true;
var Cat = /** @class */ (function () {
    function Cat() {
    }
    return Cat;
}());
exports.Cat = Cat;
var CatBag = /** @class */ (function () {
    function CatBag(cats) {
    }
    return CatBag;
}());
exports.CatBag = CatBag;
var cat = new Cat();
var catThing = {
    barry: cat
};
var catBag = new CatBag(catThing);
