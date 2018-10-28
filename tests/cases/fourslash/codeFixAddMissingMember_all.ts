/// <reference path='fourslash.ts' />

////class C {
////    method() {
////        this.x = 0;
////        this.y();
////        this.x = "";
////    }
////}
////
////class D extends C {}
////class E extends D {
////    method() {
////        this.x = 0;
////        this.ex = 0;
////    }
////}
////
////class Unrelated {
////    method() {
////        this.x = 0;
////    }
////}
////
////enum En {}
////En.A;

verify.codeFixAll({
    fixId: "addMissingMember",
    fixAllDescription: "Add all missing members",
    newFileContent:
`class C {
    x: number;
    method() {
        this.x = 0;
        this.y();
        this.x = "";
    }
    y(): any {
        throw new Error("Method not implemented.");
    }
}

class D extends C {}
class E extends D {
    ex: number;
    method() {
        this.x = 0;
        this.ex = 0;
    }
}

class Unrelated {
    x: number;
    method() {
        this.x = 0;
    }
}

enum En {
    A
}
En.A;`,
});
