// ==ORIGINAL==

export default class {
    M() {
        /*[#|*/1 + 1/*|]*/;
    }
}
// ==SCOPE::Extract to method in anonymous class declaration==

export default class {
    M() {
        this./*RENAME*/newMethod();
    }

    private newMethod() {
        1 + 1;
    }
}
// ==SCOPE::Extract to function in module scope==

export default class {
    M() {
        /*RENAME*/newFunction();
    }
}

function newFunction() {
    1 + 1;
}
