// ==ORIGINAL==
class C {
    M1() { }
    M2() {
        /*[#|*/return 1;/*|]*/
    }
    M3() { }
    constructor() { }
}
// ==SCOPE::Extract to method in class 'C'==
class C {
    M1() { }
    M2() {
        return this./*RENAME*/newMethod();
    }
    private newMethod() {
        return 1;
    }

    M3() { }
    constructor() { }
}
// ==SCOPE::Extract to function in global scope==
class C {
    M1() { }
    M2() {
        return /*RENAME*/newFunction();
    }
    M3() { }
    constructor() { }
}

function newFunction() {
    return 1;
}
