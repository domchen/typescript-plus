// ==ORIGINAL==
class C {
    M1() { }
    M2() {
        /*[#|*/return 1;/*|]*/
    }
    constructor() { }
    M3() { }
}
// ==SCOPE::Extract to method in class 'C'==
class C {
    M1() { }
    M2() {
        return this./*RENAME*/newMethod();
    }
    constructor() { }
    newMethod() {
        return 1;
    }

    M3() { }
}
// ==SCOPE::Extract to function in global scope==
class C {
    M1() { }
    M2() {
        return /*RENAME*/newFunction();
    }
    constructor() { }
    M3() { }
}

function newFunction() {
    return 1;
}
