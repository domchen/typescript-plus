/// <reference path='fourslash.ts'/>

////class A<T> {
////    value: T; // Make the type parameter actually matter
////    ms(this: A<string>) {}
////    mo(this: A<{}>) {}
////    mt(this: A<T>) {}
////    mp<P>(this: A<P>) {}
////    mps<P extends string>(this: A<P>) {}
////}
////
////const s = new A<string>();
////const n = new A<number>();
////s./*s*/;
////n./*n*/;

verify.completionsAt("s", ["value", "ms", "mo", "mt", "mp", "mps"]);
verify.completionsAt("n", ["value", "mo", "mt", "mp"]);
