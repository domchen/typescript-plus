// ==ORIGINAL==
class C<T1, T2> {
    M(t1: T1, t2: T2) {
        /*[#|*/t1.toString()/*|]*/;
    }
}
// ==SCOPE::Extract to method in class 'C'==
class C<T1, T2> {
    M(t1: T1, t2: T2) {
        this./*RENAME*/newMethod(t1);
    }

    private newMethod(t1: T1) {
        t1.toString();
    }
}
// ==SCOPE::Extract to function in global scope==
class C<T1, T2> {
    M(t1: T1, t2: T2) {
        /*RENAME*/newFunction<T1>(t1);
    }
}

function newFunction<T1>(t1: T1) {
    t1.toString();
}
